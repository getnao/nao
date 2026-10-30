import type Stripe from 'stripe';

import type { DBOrganizationBilling } from '../db/abstractSchema';
import { isCloudBillingEnabled, isCloudFreeTierEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import {
	claimOrganizationSeatEmailNotification,
	listOrganizationSeatStates,
	releaseOrganizationSeatEmailNotification,
	syncOrganizationSeatState,
} from '../queries/organization-seat-state.queries';
import * as userQueries from '../queries/user.queries';
import { isTerminalBillingStatus } from '../types/billing';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger, serializeError } from '../utils/logger';
import { type CloudEntitlement, resolveCloudEntitlement } from './cloud-billing-access.service';
import { sendCapacityContractionEmails } from './email';
import {
	cancelCloudTrialPlaceholderSubscription,
	type ClassifiedCloudSubscription,
	cloudSubscriptionProjection,
	hasCloudDefaultPaymentMethod,
	listCloudSubscriptions,
	updateCloudPaidSubscriptionTrialEnd,
} from './stripe.service';

const CURRENT_STATUS_PRIORITY = ['active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete'];

export interface CloudBillingReconciliationResult {
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
		input.organizationIdHint ??
		(await billingQueries.getOrganizationBillingByStripeCustomerId(input.stripeCustomerId))?.orgId;
	if (!organizationId) {
		return reconcileCloudBillingCustomerUnderLock(input);
	}
	return withKeyedLock(`cloud-seats:${organizationId}`, () => reconcileCloudBillingCustomerUnderLock(input));
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
	const newlyReadOnlyUserIds = applied
		? await syncReconciledOrganizationSeatState(billing.orgId, claim.billing, projection)
		: [];
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

async function syncReconciledOrganizationSeatState(
	organizationId: string,
	beforeBilling: DBOrganizationBilling,
	afterBilling: billingQueries.SubscriptionProjection,
): Promise<string[]> {
	if (!isCloudFreeTierEnabled()) {
		return [];
	}
	const organization = await organizationQueries.getOrganizationById(organizationId);
	if (!organization) {
		return [];
	}
	const seatUserCount = await organizationQueries.countOrgSeatUsers(organizationId);
	const entitlementInput = {
		bypassBilling: organization.bypassBilling,
		cloudBillingEnabled: isCloudBillingEnabled(),
		freeTierEnabled: true,
		seatUserCount,
	};
	const before = resolveCloudEntitlement({ ...entitlementInput, billing: beforeBilling });
	const after = resolveCloudEntitlement({ ...entitlementInput, billing: afterBilling });
	const [beforeReadOnlyIds, afterReadOnlyIds] = await Promise.all([
		readOnlyUserIds(organizationId, before),
		readOnlyUserIds(organizationId, after),
	]);
	const newlyReadOnlyUserIds = [...afterReadOnlyIds].filter((userId) => !beforeReadOnlyIds.has(userId));
	const newlySeatedUserIds = [...beforeReadOnlyIds].filter((userId) => !afterReadOnlyIds.has(userId));
	const changedAt = new Date();
	await Promise.all([
		...newlyReadOnlyUserIds.map((userId) =>
			syncOrganizationSeatState({ orgId: organizationId, userId, isReadOnly: true, changedAt }),
		),
		...newlySeatedUserIds.map((userId) =>
			syncOrganizationSeatState({ orgId: organizationId, userId, isReadOnly: false, changedAt }),
		),
	]);
	return newlyReadOnlyUserIds;
}

async function readOnlyUserIds(organizationId: string, entitlement: CloudEntitlement): Promise<Set<string>> {
	if (entitlement.tier === 'team' && entitlement.seatQuantity === null) {
		return new Set((await organizationQueries.listOrgSeatCandidates(organizationId)).map(({ id }) => id));
	}
	if (!entitlement.overCapacity || entitlement.seatLimit === null) {
		return new Set();
	}
	return new Set(
		(await organizationQueries.listReadOnlyOrgUsers(organizationId, entitlement.seatLimit)).map(({ id }) => id),
	);
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
