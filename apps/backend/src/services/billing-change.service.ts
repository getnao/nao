import { createHmac, timingSafeEqual } from 'node:crypto';

import type Stripe from 'stripe';

import { env } from '../env';
import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import { listOrgSeatCandidates } from '../queries/organization-seat.queries';
import * as userQueries from '../queries/user.queries';
import {
	CLOUD_BILLING_PLANS,
	type CloudBillingPlanKey,
	FREE_TIER_SEAT_LIMIT,
	isCloudBillingPlanKey,
	isTerminalBillingStatus,
} from '../types/billing';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { type CloudSubscriptionChangeIntent, readCloudSubscriptionChangeIntent } from '../utils/stripe';
import {
	type AdminBillingInput,
	CloudBillingManagementInputError,
	loadCloudBillingOrganization,
	planQuantity,
} from './billing-management.service';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
import { getOrganizationSeats, resolveSeatedUserIds } from './cloud-billing-access.service';
import { putOrganizationMemberWithSeat } from './membership.service';
import { applySeatSelection, validateSeatSelection, withOrganizationSeatLock } from './organization-seat.service';
import { getCloudSubscription } from './stripe.service';
import {
	applyCloudSubscriptionChange,
	type CloudSubscriptionChangeResult,
	findCloudPromotionCode,
	getCloudProrationDate,
	getPendingCloudSubscriptionChange,
	previewCloudSubscriptionChange,
	releaseCloudSubscriptionSchedule,
	scheduleCloudSubscriptionChange,
	setCloudSubscriptionCancellation,
} from './stripe-subscription-change.service';

const PREVIEW_TTL_MS = 5 * 60_000;

type ChangeTarget = {
	planKey: CloudBillingPlanKey;
	seats: number | null;
	promotionCodeId?: string;
	member?: { userId: string; role: OrgRole };
};

type PreviewToken = ChangeTarget & {
	organizationId: string;
	baseline: string;
	prorationDate: number;
	expiresAt: number;
};

type PaidState = {
	organization: OrganizationWithBilling;
	billing: NonNullable<OrganizationWithBilling['billing']> & {
		billingPlan: CloudBillingPlanKey;
		stripeCustomerId: string;
		stripeSubscriptionId: string;
		currentPeriodEndsAt: Date;
	};
	subscription: Stripe.Subscription;
};

export class CloudBillingChangeConflictError extends HandlerError {
	constructor(message: string) {
		super('CONFLICT', message);
		this.name = 'CloudBillingChangeConflictError';
	}
}

export async function previewCloudChangeForAdmin(
	input: AdminBillingInput & { targetPlanKey: CloudBillingPlanKey; seats?: number; promotionCode?: string },
) {
	const state = await loadPaidState(input.organizationId);
	const target: ChangeTarget = {
		planKey: input.targetPlanKey,
		seats:
			CLOUD_BILLING_PLANS[input.targetPlanKey].tier === 'team'
				? planQuantity(input.targetPlanKey, input.seats)
				: null,
	};
	if (target.planKey === state.billing.billingPlan && target.seats === state.billing.seatQuantity) {
		throw new CloudBillingManagementInputError(
			hasSeatOnlySchedule(state.billing)
				? 'Cancel the scheduled seat change to keep the current quantity'
				: 'Choose a different plan or seat count',
		);
	}
	if (!input.promotionCode) {
		return { ...(await createPreview(state, target)), promotionCodeDiscount: null };
	}
	const promotion = await resolvePromotionCode(input.promotionCode, state, target);
	target.promotionCodeId = promotion.id;
	return {
		...(await createPreview(state, target)),
		promotionCodeDiscount: { amount: promotion.discountedPlanAmount, duration: promotion.duration },
	};
}

/** Team admins add a member with one more seat when every paid seat is already taken. */
export async function previewCloudMemberSeatForAdmin(
	input: AdminBillingInput & { memberUserId?: string; email?: string; role: OrgRole },
) {
	const state = await loadPaidState(input.organizationId);
	if (CLOUD_BILLING_PLANS[state.billing.billingPlan].tier !== 'team' || state.billing.seatQuantity === null) {
		throw new CloudBillingManagementInputError('An added seat is available only on Team');
	}
	const user = await findMember(input);
	return createPreview(state, {
		planKey: state.billing.billingPlan,
		seats: planQuantity(state.billing.billingPlan, await memberSeatTarget(state, user.id)),
		member: { userId: user.id, role: input.role },
	});
}

export async function confirmCloudChangeForAdmin(
	input: AdminBillingInput & { previewToken: string; requestId: string },
): Promise<CloudSubscriptionChangeResult> {
	const token = decodePreviewToken(input.previewToken);
	if (token.organizationId !== input.organizationId || token.expiresAt <= Date.now()) {
		throw new CloudBillingChangeConflictError('Billing preview is invalid or expired; request a new preview');
	}
	const state = await loadPaidState(input.organizationId);
	if (baselineOf(state) !== token.baseline) {
		throw new CloudBillingChangeConflictError('Billing state changed; request a new preview');
	}
	const pendingPayment = await getPendingCloudSubscriptionChange(state.subscription);
	if (pendingPayment) {
		assertPendingTarget(state.subscription, token);
		return pendingPayment;
	}
	if (token.member && (await memberSeatTarget(state, token.member.userId)) !== token.seats) {
		throw new CloudBillingChangeConflictError('Billing preview is stale; preview the added seat again');
	}
	const result = await applyChange(state, token, input.requestId);
	if (result.status === 'completed') {
		await reconcile(state);
		if (token.member && token.seats === state.billing.seatQuantity) {
			await putOrganizationMemberWithSeat(input.organizationId, token.member.userId, token.member.role);
		}
	}
	return result;
}

export async function switchCloudSubscriptionToFreeForAdmin(
	input: AdminBillingInput & { selectedUserIds?: string[]; requestId: string },
) {
	const state = await loadPaidState(input.organizationId);
	if (state.billing.stripeSubscriptionScheduleId) {
		throw new CloudBillingChangeConflictError('Cancel the pending plan change first');
	}
	if (input.selectedUserIds) {
		await validateSeatSelection(input.organizationId, input.selectedUserIds, FREE_TIER_SEAT_LIMIT);
	}
	await billingQueries.setPendingFreeSeatSelection(input.organizationId, input.selectedUserIds ?? null);
	await setCloudSubscriptionCancellation({
		organizationId: input.organizationId,
		subscription: state.subscription,
		cancelAtPeriodEnd: true,
		requestId: input.requestId,
	});
	await reconcile(state);
}

export async function keepCloudSubscriptionForAdmin(input: AdminBillingInput & { requestId: string }) {
	const state = await loadPaidState(input.organizationId);
	if (!state.subscription.cancel_at_period_end) {
		throw new CloudBillingChangeConflictError('The subscription is no longer scheduled to switch to Free');
	}
	await setCloudSubscriptionCancellation({
		organizationId: input.organizationId,
		subscription: state.subscription,
		cancelAtPeriodEnd: false,
		requestId: input.requestId,
	});
	await reconcile(state);
}

export async function cancelPendingCloudChangeForAdmin(input: AdminBillingInput) {
	const state = await loadPaidState(input.organizationId);
	if (!state.billing.stripeSubscriptionScheduleId) {
		throw new CloudBillingChangeConflictError('There is no pending plan change');
	}
	await releaseCloudSubscriptionSchedule(state.billing.stripeSubscriptionScheduleId);
	await reconcile(state);
}

export async function selectCloudSeatsForAdmin(input: AdminBillingInput & { selectedUserIds: string[] }) {
	await withOrganizationSeatLock(input.organizationId, async () => {
		const { entitlement } = await getOrganizationSeats(input.organizationId);
		if (entitlement.seatLimit === null) {
			throw new CloudBillingManagementInputError('This plan does not use seat assignments');
		}
		await validateSeatSelection(input.organizationId, input.selectedUserIds, entitlement.seatLimit);
		await applySeatSelection(input.organizationId, input.selectedUserIds);
	});
}

async function createPreview(state: PaidState, target: ChangeTarget) {
	assertCanChange(state, target);
	if (state.subscription.pending_update) {
		assertPendingTarget(state.subscription, target);
	}
	const immediate = isImmediateChange(state, target);
	const prorationDate = await getCloudProrationDate(state.subscription);
	const [money, candidates] = await Promise.all([
		previewCloudSubscriptionChange({
			subscription: state.subscription,
			targetPlanKey: target.planKey,
			targetQuantity: target.seats ?? 1,
			prorationDate,
			chargeNow: immediate && state.subscription.status !== 'trialing',
			promotionCodeId: target.promotionCodeId,
		}),
		listOrgSeatCandidates(state.organization.id),
	]);
	const seatedUserIds = resolveSeatedUserIds(candidates, target.member ? null : target.seats);
	const expiresAt = Date.now() + PREVIEW_TTL_MS;
	return {
		...money,
		previewToken: encodePreviewToken({
			...target,
			organizationId: state.organization.id,
			baseline: baselineOf(state),
			prorationDate: prorationDate.getTime(),
			expiresAt,
		}),
		expiresAt: new Date(expiresAt),
		effective: immediate ? ('immediate' as const) : ('period_end' as const),
		effectiveAt: immediate ? prorationDate : state.billing.currentPeriodEndsAt,
		firstChargeAt: state.subscription.status === 'trialing' ? state.billing.trialEndsAt : null,
		targetPlanKey: target.planKey,
		seats: target.seats,
		readOnlyUsersAfterChange: candidates
			.filter(({ id }) => !seatedUserIds.has(id))
			.map(({ id, name, email }) => ({ id, name, email })),
	};
}

async function applyChange(
	state: PaidState,
	target: ChangeTarget & { prorationDate: number },
	requestId: string,
): Promise<CloudSubscriptionChangeResult> {
	const quantity = target.seats ?? 1;
	if (target.planKey === state.billing.billingPlan && quantity === (state.billing.seatQuantity ?? 1)) {
		return { status: 'completed' };
	}
	if (!isImmediateChange(state, target)) {
		await scheduleCloudSubscriptionChange({
			organizationId: state.organization.id,
			subscription: state.subscription,
			targetPlanKey: target.planKey,
			targetQuantity: quantity,
			promotionCodeId: target.promotionCodeId,
			requestId,
		});
		return { status: 'completed' };
	}
	const intent: CloudSubscriptionChangeIntent = {
		target: changeTargetKey(target),
		...(state.billing.stripeSubscriptionScheduleId
			? { releaseScheduleId: state.billing.stripeSubscriptionScheduleId }
			: {}),
		...(target.member ? { member: target.member } : {}),
	};
	try {
		return await applyCloudSubscriptionChange({
			organizationId: state.organization.id,
			subscription: state.subscription,
			targetPlanKey: target.planKey,
			targetQuantity: quantity,
			prorationDate: new Date(target.prorationDate),
			chargeNow: state.subscription.status !== 'trialing',
			promotionCodeId: target.promotionCodeId,
			requestId,
			intent,
		});
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 402) {
			throw new CloudBillingManagementInputError(
				"Stripe couldn't start payment for this change. Review billing details in Stripe and retry.",
			);
		}
		throw error;
	}
}

/** Upgrades apply now and are charged prorated; downgrades wait for the period end so nobody is refunded. */
function isImmediateChange(state: PaidState, target: ChangeTarget): boolean {
	if (state.subscription.status === 'trialing') {
		return true;
	}
	const current = CLOUD_BILLING_PLANS[state.billing.billingPlan];
	const next = CLOUD_BILLING_PLANS[target.planKey];
	if (current.tier !== next.tier) {
		return next.tier === 'unlimited';
	}
	if (current.interval !== next.interval) {
		return next.interval === 'yearly';
	}
	return (target.seats ?? 1) > (state.billing.seatQuantity ?? 1);
}

function assertCanChange(state: PaidState, target: ChangeTarget): void {
	if (['past_due', 'unpaid', 'paused'].includes(state.billing.billingStatus ?? '')) {
		throw new CloudBillingManagementInputError('Fix the subscription payment before changing the plan');
	}
	const immediate = isImmediateChange(state, target);
	if (state.billing.cancellationScheduled && !immediate) {
		throw new CloudBillingChangeConflictError('Keep your plan before making another billing change');
	}
	if (
		state.billing.stripeSubscriptionScheduleId &&
		!(hasSeatOnlySchedule(state.billing) && target.planKey === state.billing.billingPlan)
	) {
		throw new CloudBillingChangeConflictError('Cancel the pending plan change first');
	}
}

function hasSeatOnlySchedule(billing: PaidState['billing']): boolean {
	return (
		billing.stripeSubscriptionScheduleId !== null &&
		billing.pendingBillingPlan === billing.billingPlan &&
		billing.pendingSeatQuantity !== null
	);
}

function assertPendingTarget(subscription: Stripe.Subscription, target: ChangeTarget): void {
	if (readCloudSubscriptionChangeIntent(subscription.pending_update?.metadata)?.target !== changeTargetKey(target)) {
		throw new CloudBillingChangeConflictError(
			'Another billing change is waiting for payment. Pay its invoice or wait for it to expire.',
		);
	}
}

function changeTargetKey(target: ChangeTarget): string {
	return [target.planKey, target.seats ?? '', target.promotionCodeId ?? '', target.member?.userId ?? ''].join(':');
}

async function memberSeatTarget(state: PaidState, userId: string): Promise<number> {
	const candidates = await listOrgSeatCandidates(state.organization.id);
	const seats = state.billing.seatQuantity ?? 0;
	const seatedUserIds = resolveSeatedUserIds(candidates, seats);
	const needsSeat = candidates.some(({ id }) => id === userId)
		? !seatedUserIds.has(userId)
		: seatedUserIds.size >= seats;
	return needsSeat ? seats + 1 : seats;
}

async function findMember(input: { memberUserId?: string; email?: string }) {
	const user = input.memberUserId
		? await userQueries.getUser({ id: input.memberUserId })
		: input.email
			? await userQueries.getUser({ email: input.email })
			: null;
	if (!user) {
		throw new CloudBillingManagementInputError('Member was not found');
	}
	return user;
}

async function resolvePromotionCode(code: string, state: PaidState, target: ChangeTarget) {
	const match = await findCloudPromotionCode({
		code: code.trim(),
		stripeCustomerId: state.billing.stripeCustomerId,
		targetPlanKey: target.planKey,
		targetQuantity: target.seats ?? 1,
		currency: state.subscription.currency,
	});
	if (!match) {
		throw new CloudBillingManagementInputError('Promotion code is invalid or expired');
	}
	return match;
}

async function loadPaidState(organizationId: string): Promise<PaidState> {
	const organization = await loadCloudBillingOrganization(organizationId);
	const billing = organization.billing;
	if (
		!billing?.billingPlan ||
		!billing.stripeCustomerId ||
		!billing.stripeSubscriptionId ||
		!billing.currentPeriodEndsAt ||
		isTerminalBillingStatus(billing.billingStatus)
	) {
		throw new CloudBillingManagementInputError('No current paid subscription is available');
	}
	if (!isCloudBillingPlanKey(billing.billingPlan)) {
		throw new CloudBillingManagementInputError('Legacy subscriptions cannot be changed in-app');
	}
	const subscription = await getCloudSubscription(billing.stripeSubscriptionId);
	if (isTerminalBillingStatus(subscription.status)) {
		throw new CloudBillingManagementInputError('No current paid subscription is available');
	}
	return {
		organization,
		billing: {
			...billing,
			billingPlan: billing.billingPlan,
			stripeCustomerId: billing.stripeCustomerId,
			stripeSubscriptionId: billing.stripeSubscriptionId,
			currentPeriodEndsAt: billing.currentPeriodEndsAt,
		},
		subscription,
	};
}

async function reconcile(state: PaidState): Promise<void> {
	await reconcileCloudBillingCustomer({
		stripeCustomerId: state.billing.stripeCustomerId,
		organizationIdHint: state.organization.id,
	});
}

function baselineOf({ billing, subscription }: PaidState): string {
	return JSON.stringify([
		billing.stripeSubscriptionId,
		billing.billingPlan,
		billing.seatQuantity,
		subscription.currency,
		billing.currentPeriodEndsAt.getTime(),
		billing.stripeSubscriptionScheduleId,
		billing.pendingBillingPlan,
		billing.pendingSeatQuantity,
		billing.cancellationScheduled,
	]);
}

function encodePreviewToken(token: PreviewToken): string {
	const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
	return `${payload}.${sign(payload).toString('base64url')}`;
}

function decodePreviewToken(token: string): PreviewToken {
	const [payload, signature, extra] = token.split('.');
	const expected = payload ? sign(payload) : null;
	const actual = Buffer.from(signature ?? '', 'base64url');
	if (!expected || extra !== undefined || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		throw new CloudBillingChangeConflictError('Billing preview is invalid or expired; request a new preview');
	}
	return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewToken;
}

function sign(payload: string): Buffer {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest();
}
