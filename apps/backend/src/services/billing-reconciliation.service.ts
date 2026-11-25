import type Stripe from 'stripe';

import type { DBOrganizationBilling } from '../db/abstractSchema';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import { isTerminalBillingStatus } from '../types/billing';
import { logger, serializeError } from '../utils/logger';
import { readCloudSubscriptionChangeIntent } from '../utils/stripe';
import { getOrganizationCloudEntitlement } from './cloud-billing-access.service';
import { putOrganizationMemberWithSeat } from './membership.service';
import {
	applyPendingFreeSeatSelection,
	syncOrganizationSeats,
	withOrganizationSeatLock,
} from './organization-seat.service';
import { notifyAdminsOfReadOnlyMembers } from './seat-notification.service';
import {
	cancelCloudTrialPlaceholderSubscription,
	type ClassifiedCloudSubscription,
	cloudSubscriptionProjection,
	hasCloudDefaultPaymentMethod,
	listCloudSubscriptions,
	updateCloudPaidSubscriptionTrialEnd,
} from './stripe.service';
import {
	clearCloudSubscriptionChangeIntent,
	releaseCloudSubscriptionSchedule,
} from './stripe-subscription-change.service';

const CURRENT_STATUS_PRIORITY = ['active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete'];

interface CloudBillingReconciliationResult {
	applied: boolean;
	ignored: boolean;
}

export async function reconcileCloudBillingCustomer(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	const organizationId =
		(await billingQueries.getOrganizationBillingByStripeCustomerId(input.stripeCustomerId))?.orgId ??
		input.organizationIdHint;
	return organizationId
		? withOrganizationSeatLock(organizationId, () => reconcileUnderSeatLock(input))
		: reconcileUnderSeatLock(input);
}

async function reconcileUnderSeatLock(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	const billing = await resolveOrganizationBilling(input.stripeCustomerId, input.organizationIdHint);
	if (!billing) {
		return { applied: false, ignored: true };
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
		};
	}

	assertSubscriptionOwnership(selected.subscription, input.stripeCustomerId, billing.orgId);
	selected = await carryForwardLatestTrialEnd(selected, classified, billing.orgId);
	const projection = await cloudSubscriptionProjection(selected.subscription);
	const applied = await billingQueries.updateSubscriptionProjection(billing.orgId, claim.token, {
		...projection,
		trialStartedAt: claim.billing.trialStartedAt ?? projection.trialStartedAt,
		trialEndsAt: projection.trialEndsAt ?? claim.billing.trialEndsAt,
	});
	if (!applied) {
		return { applied, ignored: false };
	}
	if (await settleSubscriptionChange(billing.orgId, selected.subscription, claim.billing, projection)) {
		return reconcileUnderSeatLock(input);
	}
	await syncSeatsAfterReconciliation(billing.orgId, claim.billing.pendingFreeSeatUserIds, projection);
	if (selected.kind === 'paid-cloud') {
		await cancelCurrentTrialPlaceholders(classified, billing.orgId);
	}
	return { applied, ignored: false };
}

/** Returns whether a released schedule requires another reconciliation pass. */
async function settleSubscriptionChange(
	organizationId: string,
	subscription: Stripe.Subscription,
	before: DBOrganizationBilling,
	projection: billingQueries.SubscriptionProjection,
): Promise<boolean> {
	const intent = readCloudSubscriptionChangeIntent(subscription.metadata);
	const scheduleId = projection.stripeSubscriptionScheduleId;
	const releaseScheduleId =
		scheduleId &&
		(intent?.releaseScheduleId === scheduleId ||
			(before.pendingBillingPlan !== null && !projection.pendingBillingPlan))
			? scheduleId
			: null;
	if (intent) {
		await clearCloudSubscriptionChangeIntent(subscription.id);
	}
	if (intent?.member) {
		await putOrganizationMemberWithSeat(organizationId, intent.member.userId, intent.member.role).catch((error) =>
			logger.error(`Paid seat membership activation failed for organization ${organizationId}`, {
				source: 'system',
				context: { userId: intent.member?.userId, error: serializeError(error) },
			}),
		);
	}
	if (releaseScheduleId) {
		await releaseCloudSubscriptionSchedule(releaseScheduleId);
	}
	return releaseScheduleId !== null;
}

async function syncSeatsAfterReconciliation(
	organizationId: string,
	pendingFreeSeatUserIds: string[] | null,
	projection: billingQueries.SubscriptionProjection,
): Promise<void> {
	if (pendingFreeSeatUserIds) {
		const { tier } = await getOrganizationCloudEntitlement(organizationId);
		if (tier === 'free') {
			await applyPendingFreeSeatSelection(organizationId, pendingFreeSeatUserIds);
		} else if (!projection.cancellationScheduled) {
			await billingQueries.setPendingFreeSeatSelection(organizationId, null);
		}
	}
	await syncOrganizationSeats(organizationId);
	await notifyAdminsOfReadOnlyMembers(organizationId);
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
		logger.warn('Ignored a Stripe event of an organization that no longer exists', {
			source: 'system',
			context: { organizationId, stripeCustomerId },
		});
		return null;
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
