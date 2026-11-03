import type Stripe from 'stripe';

import type { DBOrganizationBilling } from '../db/abstractSchema';
import { isCloudFreeTierEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import {
	claimOrganizationSeatEmailNotification,
	listOrganizationSeatStates,
	releaseOrganizationSeatEmailNotification,
} from '../queries/organization-seat-state.queries';
import * as userQueries from '../queries/user.queries';
import { isTerminalBillingStatus } from '../types/billing';
import { logger, serializeError } from '../utils/logger';
import { getOrganizationCloudEntitlement } from './cloud-billing-access.service';
import { sendCapacityContractionEmails } from './email';
import {
	applyPendingFreeSeatSelection,
	syncOrganizationSeats,
	withOrganizationSeatLock,
} from './organization-seat.service';
import {
	cancelCloudTrialPlaceholderSubscription,
	type ClassifiedCloudSubscription,
	cloudSubscriptionProjection,
	hasCloudDefaultPaymentMethod,
	listCloudSubscriptions,
	updateCloudPaidSubscriptionTrialEnd,
} from './stripe.service';
import { releaseCloudPlanChangeSchedule } from './stripe-subscription-change.service';

const CURRENT_STATUS_PRIORITY = ['active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete'];

interface CloudBillingReconciliationResult {
	applied: boolean;
	ignored: boolean;
	before: DBOrganizationBilling | null;
	after: billingQueries.SubscriptionProjection | null;
	newlyReadOnlyUserIds: string[];
}

export async function reconcileCloudBillingCustomer(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	const organizationId =
		(await billingQueries.getOrganizationBillingByStripeCustomerId(input.stripeCustomerId))?.orgId ??
		input.organizationIdHint;
	if (!organizationId) {
		return reconcileCloudBillingCustomerUnderLock(input);
	}
	return withOrganizationSeatLock(organizationId, () => reconcileCloudBillingCustomerUnderLock(input));
}

export async function reconcileCloudBillingCustomerUnderLock(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	const billing = await resolveOrganizationBilling(input.stripeCustomerId, input.organizationIdHint);
	if (!billing) {
		return { applied: false, ignored: true, before: null, after: null, newlyReadOnlyUserIds: [] };
	}
	const claim = await billingQueries.claimBillingSync(billing.orgId, input.stripeCustomerId);
	const classified = await listCloudSubscriptions(input.stripeCustomerId);
	let selected = selectCloudSubscription(classified, claim.billing.stripeSubscriptionId);
	logDuplicateCurrentSubscriptions(input.stripeCustomerId, classified, selected);

	if (!selected) {
		return {
			applied: await billingQueries.updatePaymentMethodProjection(
				billing.orgId,
				claim.token,
				input.stripeCustomerId,
				await hasCloudDefaultPaymentMethod(input.stripeCustomerId),
			),
			ignored: false,
			before: claim.billing,
			after: null,
			newlyReadOnlyUserIds: [],
		};
	}

	assertSubscriptionOwnership(selected.subscription, input.stripeCustomerId, billing.orgId);
	selected = await carryForwardLatestTrialEnd(selected, classified, billing.orgId);
	const stripeProjection = await cloudSubscriptionProjection(selected.subscription);
	const projection = {
		...stripeProjection,
		trialStartedAt: claim.billing.trialStartedAt ?? stripeProjection.trialStartedAt,
		trialEndsAt: stripeProjection.trialEndsAt ?? claim.billing.trialEndsAt,
	};
	const applied = await billingQueries.updateSubscriptionProjection(billing.orgId, claim.token, projection);
	if (
		applied &&
		projection.stripeSubscriptionScheduleId &&
		isPendingBillingChangeActivated(claim.billing, projection)
	) {
		await releaseCloudPlanChangeSchedule(projection.stripeSubscriptionScheduleId);
		return reconcileCloudBillingCustomerUnderLock(input);
	}
	const newlyReadOnlyUserIds = applied ? await syncReconciledOrganizationSeats(billing.orgId, claim.billing) : [];
	if (applied && isCloudFreeTierEnabled()) {
		try {
			await notifyPendingCapacityContraction(billing.orgId);
		} catch (error) {
			logger.error(`Capacity contraction notification failed for organization ${billing.orgId}`, {
				source: 'system',
				context: serializeError(error),
			});
		}
	}
	if (applied && selected.kind === 'paid-cloud') {
		await cancelCurrentTrialPlaceholders(classified, billing.orgId);
	}
	return {
		applied,
		ignored: false,
		before: claim.billing,
		after: applied ? projection : null,
		newlyReadOnlyUserIds,
	};
}

/** A seat-only change keeps the plan key, so activation also requires the pending quantity and no future phase. */
export function isPendingBillingChangeActivated(
	pending: Pick<DBOrganizationBilling, 'pendingBillingPlan' | 'pendingSeatQuantity'>,
	projection: Pick<billingQueries.SubscriptionProjection, 'billingPlan' | 'seatQuantity' | 'pendingBillingPlan'>,
): boolean {
	return (
		pending.pendingBillingPlan !== null &&
		!projection.pendingBillingPlan &&
		projection.billingPlan === pending.pendingBillingPlan &&
		(pending.pendingSeatQuantity === null || projection.seatQuantity === pending.pendingSeatQuantity)
	);
}

export async function releasePendingBillingChange(organizationId: string, scheduleId: string): Promise<void> {
	await releaseCloudPlanChangeSchedule(scheduleId);
	await billingQueries.clearPendingBillingChange(organizationId);
}

async function notifyPendingCapacityContraction(organizationId: string): Promise<void> {
	const userIds = (await listOrganizationSeatStates(organizationId))
		.filter(({ isReadOnly, adminEmailNotifiedAt }) => isReadOnly && adminEmailNotifiedAt === null)
		.map(({ userId }) => userId);
	const claimedAt = new Date();
	const claimedUserIds: string[] = [];
	for (const userId of userIds) {
		if (await claimOrganizationSeatEmailNotification(organizationId, userId, 'admin_email', claimedAt)) {
			claimedUserIds.push(userId);
		}
	}
	if (claimedUserIds.length === 0) {
		return;
	}
	try {
		const users = await userQueries.getUsersByIds(claimedUserIds);
		await sendCapacityContractionEmails({ organizationId, readOnlyUsers: users });
	} catch (error) {
		await Promise.all(
			claimedUserIds.map((userId) =>
				releaseOrganizationSeatEmailNotification(organizationId, userId, 'admin_email', claimedAt),
			),
		);
		throw error;
	}
}

async function syncReconciledOrganizationSeats(
	organizationId: string,
	beforeBilling: DBOrganizationBilling,
): Promise<string[]> {
	if (!isCloudFreeTierEnabled()) {
		return [];
	}
	const entitlement = await getOrganizationCloudEntitlement(organizationId);
	if (entitlement?.tier === 'free' && beforeBilling.pendingFreeSeatUserIds) {
		return applyPendingFreeSeatSelection(organizationId, beforeBilling.pendingFreeSeatUserIds, entitlement);
	}
	return syncOrganizationSeats(organizationId, entitlement);
}

async function resolveOrganizationBilling(stripeCustomerId: string, organizationIdHint?: string) {
	const attached = await billingQueries.getOrganizationBillingByStripeCustomerId(stripeCustomerId);
	if (attached) {
		return attached;
	}

	const classified = await listCloudSubscriptions(stripeCustomerId);
	const liveOrganizationId = selectCloudSubscription(classified)?.subscription.metadata.nao_org_id;
	const organizationId = liveOrganizationId ?? organizationIdHint;
	if (!organizationId) {
		return null;
	}

	const organization = await organizationQueries.getOrganizationById(organizationId);
	if (!organization) {
		throw new Error(`Organization "${organizationId}" was not found`);
	}
	return billingQueries.attachStripeCustomer(organization.id, stripeCustomerId);
}

async function carryForwardLatestTrialEnd(
	selected: ClassifiedCloudSubscription,
	classified: ClassifiedCloudSubscription[],
	organizationId: string,
): Promise<ClassifiedCloudSubscription> {
	if (selected.kind !== 'paid-cloud' || selected.subscription.status !== 'trialing') {
		return selected;
	}
	const latestPlaceholderTrialEnd = classified
		.filter(
			(entry) =>
				entry.kind === 'trial-placeholder' &&
				!isTerminalBillingStatus(entry.subscription.status) &&
				entry.subscription.trial_end !== null,
		)
		.reduce((latest, entry) => Math.max(latest, entry.subscription.trial_end ?? 0), 0);
	if (latestPlaceholderTrialEnd === 0 || latestPlaceholderTrialEnd <= (selected.subscription.trial_end ?? 0)) {
		return selected;
	}
	const subscription = await updateCloudPaidSubscriptionTrialEnd(
		selected.subscription,
		organizationId,
		new Date(latestPlaceholderTrialEnd * 1000),
	);
	return { kind: selected.kind, subscription };
}

async function cancelCurrentTrialPlaceholders(
	classified: ClassifiedCloudSubscription[],
	organizationId: string,
): Promise<void> {
	await Promise.all(
		classified
			.filter(
				(entry) => entry.kind === 'trial-placeholder' && !isTerminalBillingStatus(entry.subscription.status),
			)
			.map(({ subscription }) => cancelCloudTrialPlaceholderSubscription(subscription, organizationId)),
	);
}

function selectCloudSubscription(
	classified: ClassifiedCloudSubscription[],
	preferredSubscriptionId?: string | null,
): ClassifiedCloudSubscription | null {
	const paid = classified.filter(({ kind }) => kind === 'paid-cloud');
	const candidates = paid.length > 0 ? paid : classified;
	const current = candidates.filter(({ subscription }) => !isTerminalBillingStatus(subscription.status));
	if (current.length > 0) {
		return [...current].sort((left, right) => {
			const statusDifference =
				currentStatusPriority(left.subscription.status) - currentStatusPriority(right.subscription.status);
			if (statusDifference !== 0) {
				return statusDifference;
			}
			if (left.subscription.id === preferredSubscriptionId) {
				return -1;
			}
			if (right.subscription.id === preferredSubscriptionId) {
				return 1;
			}
			return (
				left.subscription.created - right.subscription.created ||
				left.subscription.id.localeCompare(right.subscription.id)
			);
		})[0];
	}

	return [...candidates].sort((left, right) => right.subscription.created - left.subscription.created)[0] ?? null;
}

function currentStatusPriority(status: string): number {
	const priority = CURRENT_STATUS_PRIORITY.indexOf(status);
	return priority === -1 ? CURRENT_STATUS_PRIORITY.length : priority;
}

function logDuplicateCurrentSubscriptions(
	stripeCustomerId: string,
	classified: ClassifiedCloudSubscription[],
	selected: ClassifiedCloudSubscription | null,
): void {
	const current = classified.filter(({ subscription }) => !isTerminalBillingStatus(subscription.status));
	const hasDuplicates = current.some(
		({ kind }, index) => current.findIndex((candidate) => candidate.kind === kind) !== index,
	);
	if (!hasDuplicates || !selected) {
		return;
	}
	logger.error(`Stripe Customer "${stripeCustomerId}" has multiple current cloud subscriptions`, {
		source: 'system',
		context: {
			currentSubscriptionIds: current.map(({ subscription }) => subscription.id),
			selectedSubscriptionId: selected.subscription.id,
		},
	});
}

function assertSubscriptionOwnership(
	subscription: Stripe.Subscription,
	stripeCustomerId: string,
	organizationId: string,
): void {
	const subscriptionCustomerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
	if (subscriptionCustomerId !== stripeCustomerId) {
		throw new Error(`Stripe Subscription "${subscription.id}" has an unexpected Customer`);
	}
	const metadataOrganizationId = subscription.metadata.nao_org_id;
	if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
		throw new Error(`Stripe Subscription "${subscription.id}" organization metadata does not match`);
	}
}
