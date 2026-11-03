import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { env } from '../env';
import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
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
import { logger, serializeError } from '../utils/logger';
import {
	type AdminBillingInput,
	CloudBillingManagementInputError,
	loadCloudBillingOrganization,
	requireOrganizationAdmin,
	validateTeamQuantity,
} from './billing-management.service';
import { reconcileCloudBillingCustomerUnderLock, releasePendingBillingChange } from './billing-reconciliation.service';
import { getOrganizationCloudEntitlement } from './cloud-billing-access.service';
import { putOrganizationMemberUnderBillingLock } from './membership.service';
import {
	applySeatSelection,
	loadSeatCandidates,
	type SeatCandidate,
	withOrganizationSeatLock,
} from './organization-seat.service';
import { getCloudSubscription } from './stripe.service';
import {
	type CloudPromotionCodeMatch,
	type CloudSubscriptionChangePreview,
	createCloudPlanChangeSchedule,
	findActiveCloudPromotionCode,
	getCloudPlanChangeSchedule,
	getCloudProrationDate,
	previewCloudSubscriptionChange,
	releaseCloudPlanChangeSchedule,
	setCloudSubscriptionCancellation,
	updateCloudPlanChangeSchedule,
	updateCloudSubscriptionPlan,
	updateCloudSubscriptionQuantity,
} from './stripe-subscription-change.service';

type BillingChangeOperation = 'seat_change' | 'plan_change' | 'add_member_with_seat';

type BillingChangeTokenPayload = {
	version: 1;
	organizationId: string;
	subscriptionId: string;
	subscriptionItemId: string;
	currentPlanKey: string;
	currentSeatQuantity: number | null;
	currency: string;
	currentPeriodEndsAt: string;
	billingUpdatedAt: string;
	subscriptionScheduleId: string | null;
	pendingPlanKey: string | null;
	pendingSeatQuantity: number | null;
	prorationDate: string;
	targetPlanKey: CloudBillingPlanKey;
	targetSeatQuantity: number | null;
	operation: BillingChangeOperation;
	effective: 'immediate' | 'period_end';
	promotionCodeId?: string;
	memberFingerprint?: string;
	expiresAt: string;
};

type BillingChangePreview = CloudSubscriptionChangePreview & {
	previewToken: string;
	expiresAt: Date;
	prorationDate: Date;
	effective: 'immediate' | 'period_end';
	effectiveAt: Date;
	firstChargeAt: Date | null;
	promotionCodeDiscount: { amount: number; duration: CloudPromotionCodeMatch['duration'] } | null;
	targetPlanKey: CloudBillingPlanKey;
	targetSeatQuantity: number | null;
	readOnlyUsersAfterChange: SeatCandidate[];
};

export async function previewCloudSeatChangeForAdmin(
	input: AdminBillingInput & { targetQuantity: number; promotionCode?: string },
): Promise<BillingChangePreview> {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		if (!state.billing.billingPlan.startsWith('cloud_team_')) {
			throw new CloudBillingManagementInputError('Seat quantity can only be changed on Team');
		}
		validateTeamQuantity(input.targetQuantity);
		assertNoBillingCommandConflict(state.billing, false, true);
		const targetPlanKey = requireCurrentPlanKey(state.billing.billingPlan);
		const currentQuantity = state.billing.seatQuantity;
		if (currentQuantity === null) {
			throw new CloudBillingManagementConflictError('Current Team seat quantity is unavailable');
		}
		if (input.targetQuantity === currentQuantity) {
			throw new CloudBillingManagementInputError(
				isSeatOnlyPendingChange(state.billing)
					? 'Cancel the scheduled seat change to keep the current quantity'
					: 'Choose a different seat quantity',
			);
		}
		const promotionCode = await resolvePromotionCode(
			input.promotionCode,
			state.billing.stripeCustomerId,
			targetPlanKey,
			input.targetQuantity,
		);
		return createBillingChangePreview(state, {
			operation: 'seat_change',
			targetPlanKey,
			targetSeatQuantity: input.targetQuantity,
			immediate: input.targetQuantity > currentQuantity,
			promotionCode,
		});
	});
}

export async function changeCloudSeatQuantityForAdmin(
	input: AdminBillingInput & { previewToken: string; requestId: string },
) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const { state, payload } = await verifyBillingChangeToken(input.organizationId, input.previewToken);
		if (payload.operation !== 'seat_change' || payload.targetSeatQuantity === null) {
			throw new CloudBillingManagementConflictError('Billing preview does not authorize a seat change');
		}
		const targetQuantity = payload.targetSeatQuantity;
		if (payload.effective === 'immediate') {
			await runCloudBillingStripeMutation(() =>
				updateCloudSubscriptionQuantity({
					organizationId: input.organizationId,
					subscription: state.subscription,
					targetQuantity,
					prorationDate: new Date(payload.prorationDate),
					requestId: input.requestId,
					promotionCodeId: payload.promotionCodeId,
				}),
			);
			if (state.billing.stripeSubscriptionScheduleId) {
				await releasePendingBillingChange(input.organizationId, state.billing.stripeSubscriptionScheduleId);
			}
		} else if (state.billing.stripeSubscriptionScheduleId) {
			await replaceCloudPlanChangeSchedule(state, targetQuantity, payload.promotionCodeId);
		} else {
			await scheduleCloudPlanChange(
				state,
				payload.targetPlanKey,
				targetQuantity,
				input.requestId,
				payload.promotionCodeId,
			);
		}
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function previewCloudPlanChangeForAdmin(
	input: AdminBillingInput & {
		targetPlanKey: CloudBillingPlanKey;
		targetSeatQuantity?: number;
		promotionCode?: string;
	},
): Promise<BillingChangePreview> {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		const target = CLOUD_BILLING_PLANS[input.targetPlanKey];
		const currentPlanKey = requireCurrentPlanKey(state.billing.billingPlan);
		const current = CLOUD_BILLING_PLANS[currentPlanKey];
		const reactivatesWithUpgrade =
			Boolean(state.billing.cancellationScheduled) && current.tier === 'team' && target.tier === 'unlimited';
		assertNoBillingCommandConflict(
			state.billing,
			state.subscription.status === 'trialing' || reactivatesWithUpgrade,
		);
		const targetSeatQuantity = target.tier === 'team' ? validateTeamQuantity(input.targetSeatQuantity) : null;
		const promotionCode = await resolvePromotionCode(
			input.promotionCode,
			state.billing.stripeCustomerId,
			input.targetPlanKey,
			targetSeatQuantity ?? 1,
		);
		const immediate =
			state.subscription.status === 'trialing' || isImmediatePlanChange(currentPlanKey, input.targetPlanKey);
		return createBillingChangePreview(state, {
			operation: 'plan_change',
			targetPlanKey: input.targetPlanKey,
			targetSeatQuantity,
			immediate,
			promotionCode,
		});
	});
}

export async function changeCloudPlanForAdmin(input: AdminBillingInput & { previewToken: string; requestId: string }) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const { state, payload } = await verifyBillingChangeToken(input.organizationId, input.previewToken);
		if (payload.operation !== 'plan_change') {
			throw new CloudBillingManagementConflictError('Billing preview does not authorize a plan change');
		}
		const targetQuantity =
			CLOUD_BILLING_PLANS[payload.targetPlanKey].tier === 'team'
				? validateTeamQuantity(payload.targetSeatQuantity ?? undefined)
				: 1;
		const immediate =
			state.subscription.status === 'trialing' ||
			isImmediatePlanChange(requireCurrentPlanKey(state.billing.billingPlan), payload.targetPlanKey);
		if (immediate) {
			await runCloudBillingStripeMutation(() =>
				updateCloudSubscriptionPlan({
					organizationId: input.organizationId,
					subscription: state.subscription,
					targetPlanKey: payload.targetPlanKey,
					targetQuantity,
					prorationDate: new Date(payload.prorationDate),
					requestId: input.requestId,
					chargeImmediately: state.subscription.status !== 'trialing',
					promotionCodeId: payload.promotionCodeId,
				}),
			);
		} else {
			await scheduleCloudPlanChange(
				state,
				payload.targetPlanKey,
				targetQuantity,
				input.requestId,
				payload.promotionCodeId,
			);
		}
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function switchCloudSubscriptionToFreeForAdmin(
	input: AdminBillingInput & { selectedUserIds?: string[]; requestId?: string },
) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		if (state.billing.stripeSubscriptionScheduleId) {
			throw new CloudBillingManagementConflictError('Cancel the pending plan change first');
		}
		if (input.selectedUserIds && state.subscription.status !== 'trialing') {
			await validateSeatSelection(input.organizationId, input.selectedUserIds, FREE_TIER_SEAT_LIMIT);
			await billingQueries.setPendingFreeSeatSelection(input.organizationId, input.selectedUserIds);
		}
		try {
			await setCloudSubscriptionCancellation({
				organizationId: input.organizationId,
				subscription: state.subscription,
				cancelAtPeriodEnd: true,
				requestId: input.requestId ?? randomUUID(),
			});
		} catch (error) {
			if (input.selectedUserIds && state.subscription.status !== 'trialing') {
				await billingQueries.setPendingFreeSeatSelection(
					input.organizationId,
					state.billing.pendingFreeSeatUserIds,
				);
			}
			throw error;
		}
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function keepCloudSubscriptionForAdmin(input: AdminBillingInput & { requestId?: string }) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		if (!state.subscription.cancel_at_period_end) {
			throw new CloudBillingManagementConflictError('The subscription is no longer scheduled to switch to Free');
		}
		await setCloudSubscriptionCancellation({
			organizationId: input.organizationId,
			subscription: state.subscription,
			cancelAtPeriodEnd: false,
			requestId: input.requestId ?? randomUUID(),
		});
		await billingQueries.setPendingFreeSeatSelection(input.organizationId, null);
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function cancelPendingCloudPlanChangeForAdmin(input: AdminBillingInput) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		const scheduleId = state.billing.stripeSubscriptionScheduleId;
		if (!scheduleId) {
			throw new CloudBillingManagementConflictError('There is no pending plan change');
		}
		await releasePendingBillingChange(input.organizationId, scheduleId);
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function selectCloudSeatsForAdmin(input: AdminBillingInput & { selectedUserIds: string[] }) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const entitlement = await getOrganizationCloudEntitlement(input.organizationId);
		const seatLimit = entitlement?.tier === 'trial' ? entitlement.seatUserCount : entitlement?.seatLimit;
		if (seatLimit === null || seatLimit === undefined) {
			throw new CloudBillingManagementInputError('This plan does not use seat assignments');
		}
		await validateSeatSelection(input.organizationId, input.selectedUserIds, seatLimit);
		await applySeatSelection(input.organizationId, input.selectedUserIds, entitlement);
		return loadSeatCandidates(input.organizationId, seatLimit);
	});
}

export async function addCloudMemberWithSeatForAdmin(
	input: AdminBillingInput & {
		memberUserId?: string;
		email?: string;
		requestedRole: OrgRole;
		previewToken: string;
		requestId: string;
	},
) {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const user = input.memberUserId
			? await userQueries.getUser({ id: input.memberUserId })
			: input.email
				? await userQueries.getUser({ email: input.email })
				: null;
		if (!user) {
			throw new CloudBillingManagementInputError('Member was not found');
		}
		const memberFingerprint = await createMemberFingerprint(input.organizationId, user.id, input.requestedRole);
		const { state, payload } = await verifyBillingChangeToken(
			input.organizationId,
			input.previewToken,
			memberFingerprint,
		);
		if (payload.operation !== 'add_member_with_seat' || payload.targetSeatQuantity === null) {
			throw new CloudBillingManagementConflictError('Billing preview does not authorize adding this member');
		}
		const currentQuantity = state.billing.seatQuantity ?? 0;
		const expectedTargetQuantity = await getMemberSeatTargetQuantity(
			input.organizationId,
			user.id,
			currentQuantity,
		);
		if (payload.targetSeatQuantity !== expectedTargetQuantity) {
			throw new CloudBillingManagementConflictError('Billing preview is stale; preview the added seat again');
		}
		const targetQuantity = payload.targetSeatQuantity;
		if (targetQuantity > currentQuantity) {
			await runCloudBillingStripeMutation(() =>
				updateCloudSubscriptionQuantity({
					organizationId: input.organizationId,
					subscription: state.subscription,
					targetQuantity,
					prorationDate: new Date(payload.prorationDate),
					requestId: input.requestId,
				}),
			);
			await reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
		}
		try {
			return await putOrganizationMemberUnderBillingLock(input.organizationId, user.id, input.requestedRole);
		} catch (error) {
			throw new CloudBillingSeatPurchasedMembershipError(error);
		}
	});
}

export class CloudBillingManagementConflictError extends HandlerError {
	constructor(message: string) {
		super('CONFLICT', message);
		this.name = 'CloudBillingManagementConflictError';
	}
}

export class CloudBillingSeatPurchasedMembershipError extends HandlerError {
	constructor(cause: unknown) {
		super(
			'CONFLICT',
			'The seat was purchased but membership activation failed. The paid seat is empty and reusable.',
		);
		this.name = 'CloudBillingSeatPurchasedMembershipError';
		this.cause = cause;
	}
}

export class CloudBillingPaymentRequiredError extends HandlerError {
	constructor() {
		super(
			'BAD_REQUEST',
			'Payment failed or requires authentication. Update the payment method in Stripe billing and retry.',
		);
		this.name = 'CloudBillingPaymentRequiredError';
	}
}

export async function previewCloudMemberSeatPurchaseForAdmin(
	input: AdminBillingInput & { memberUserId?: string; email?: string; requestedRole: OrgRole },
): Promise<BillingChangePreview> {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const user = input.memberUserId
			? await userQueries.getUser({ id: input.memberUserId })
			: input.email
				? await userQueries.getUser({ email: input.email })
				: null;
		if (!user) {
			throw new CloudBillingManagementInputError('Member was not found');
		}
		const state = await loadCurrentPaidState(input.organizationId);
		if (!state.billing.billingPlan.startsWith('cloud_team_') || state.billing.seatQuantity === null) {
			throw new CloudBillingManagementInputError('An added seat is available only on Team');
		}
		assertNoBillingCommandConflict(state.billing);
		const memberFingerprint = await createMemberFingerprint(input.organizationId, user.id, input.requestedRole);
		const targetSeatQuantity = validateTeamQuantity(
			await getMemberSeatTargetQuantity(input.organizationId, user.id, state.billing.seatQuantity),
		);
		return createBillingChangePreview(state, {
			operation: 'add_member_with_seat',
			targetPlanKey: requireCurrentPlanKey(state.billing.billingPlan),
			targetSeatQuantity,
			immediate: true,
			memberFingerprint,
		});
	});
}

type CurrentPaidState = {
	organization: OrganizationWithBilling;
	billing: NonNullable<OrganizationWithBilling['billing']> & {
		billingPlan: string;
		stripeCustomerId: string;
		stripeSubscriptionId: string;
		stripeSubscriptionItemId: string;
		currentPeriodEndsAt: Date;
	};
	subscription: Awaited<ReturnType<typeof getCloudSubscription>>;
};

async function createBillingChangePreview(
	state: CurrentPaidState,
	target: {
		operation: BillingChangeOperation;
		targetPlanKey: CloudBillingPlanKey;
		targetSeatQuantity: number | null;
		immediate: boolean;
		promotionCode?: CloudPromotionCodeMatch;
		memberFingerprint?: string;
	},
): Promise<BillingChangePreview> {
	const prorationDate = await getCloudProrationDate(state.subscription);
	const expiresAt = new Date(prorationDate.getTime() + 5 * 60_000);
	const targetQuantity = target.targetSeatQuantity ?? 1;
	const currentPlanKey = requireCurrentPlanKey(state.billing.billingPlan);
	const paidIncrease =
		state.subscription.status !== 'trialing' &&
		target.immediate &&
		(target.targetPlanKey !== currentPlanKey ||
			(target.targetSeatQuantity !== null && target.targetSeatQuantity > (state.billing.seatQuantity ?? 0)));
	const money = await previewCloudSubscriptionChange({
		subscription: state.subscription,
		targetPlanKey: target.targetPlanKey,
		targetQuantity,
		prorationDate,
		prorationBehavior: paidIncrease ? 'always_invoice' : 'none',
		promotionCodeId: target.promotionCode?.id,
	});
	const payload: BillingChangeTokenPayload = {
		version: 1,
		organizationId: state.organization.id,
		subscriptionId: state.billing.stripeSubscriptionId,
		subscriptionItemId: state.billing.stripeSubscriptionItemId,
		currentPlanKey: state.billing.billingPlan,
		currentSeatQuantity: state.billing.seatQuantity,
		currency: state.subscription.currency,
		currentPeriodEndsAt: state.billing.currentPeriodEndsAt.toISOString(),
		billingUpdatedAt: state.billing.billingUpdatedAt?.toISOString() ?? '',
		subscriptionScheduleId: state.billing.stripeSubscriptionScheduleId,
		pendingPlanKey: state.billing.pendingBillingPlan,
		pendingSeatQuantity: state.billing.pendingSeatQuantity,
		prorationDate: prorationDate.toISOString(),
		targetPlanKey: target.targetPlanKey,
		targetSeatQuantity: target.targetSeatQuantity,
		operation: target.operation,
		effective: target.immediate ? 'immediate' : 'period_end',
		...(target.promotionCode ? { promotionCodeId: target.promotionCode.id } : {}),
		...(target.memberFingerprint ? { memberFingerprint: target.memberFingerprint } : {}),
		expiresAt: expiresAt.toISOString(),
	};
	const candidates = await loadSeatCandidates(
		state.organization.id,
		CLOUD_BILLING_PLANS[target.targetPlanKey].tier === 'team' ? target.targetSeatQuantity : null,
	);
	return {
		...money,
		previewToken: signBillingChangeToken(payload),
		expiresAt,
		prorationDate,
		effective: target.immediate ? 'immediate' : 'period_end',
		effectiveAt: target.immediate ? prorationDate : state.billing.currentPeriodEndsAt,
		firstChargeAt: state.subscription.status === 'trialing' ? state.billing.trialEndsAt : null,
		promotionCodeDiscount: target.promotionCode
			? {
					amount: target.promotionCode.discountedPlanAmount,
					duration: target.promotionCode.duration,
				}
			: null,
		targetPlanKey: target.targetPlanKey,
		targetSeatQuantity: target.targetSeatQuantity,
		readOnlyUsersAfterChange: candidates.readOnlyUsers,
	};
}

async function verifyBillingChangeToken(
	organizationId: string,
	token: string,
	memberFingerprint?: string,
): Promise<{ state: CurrentPaidState; payload: BillingChangeTokenPayload }> {
	const payload = decodeBillingChangeToken(token);
	if (payload.organizationId !== organizationId || new Date(payload.expiresAt).getTime() <= Date.now()) {
		throw new CloudBillingManagementConflictError('Billing preview is invalid or expired; request a new preview');
	}
	if (payload.memberFingerprint !== memberFingerprint) {
		throw new CloudBillingManagementConflictError('Member state changed; request a new preview');
	}
	const state = await loadCurrentPaidState(organizationId);
	const baseline = {
		subscriptionId: state.billing.stripeSubscriptionId,
		subscriptionItemId: state.billing.stripeSubscriptionItemId,
		currentPlanKey: state.billing.billingPlan,
		currentSeatQuantity: state.billing.seatQuantity,
		currency: state.subscription.currency,
		currentPeriodEndsAt: state.billing.currentPeriodEndsAt.toISOString(),
		billingUpdatedAt: state.billing.billingUpdatedAt?.toISOString() ?? '',
		subscriptionScheduleId: state.billing.stripeSubscriptionScheduleId,
		pendingPlanKey: state.billing.pendingBillingPlan,
		pendingSeatQuantity: state.billing.pendingSeatQuantity,
	};
	if (
		payload.subscriptionId !== baseline.subscriptionId ||
		payload.subscriptionItemId !== baseline.subscriptionItemId ||
		payload.currentPlanKey !== baseline.currentPlanKey ||
		payload.currentSeatQuantity !== baseline.currentSeatQuantity ||
		payload.currency !== baseline.currency ||
		payload.currentPeriodEndsAt !== baseline.currentPeriodEndsAt ||
		payload.billingUpdatedAt !== baseline.billingUpdatedAt ||
		payload.subscriptionScheduleId !== baseline.subscriptionScheduleId ||
		payload.pendingPlanKey !== baseline.pendingPlanKey ||
		payload.pendingSeatQuantity !== baseline.pendingSeatQuantity
	) {
		throw new CloudBillingManagementConflictError('Billing state changed; request a new preview');
	}
	return { state, payload };
}

function signBillingChangeToken(payload: BillingChangeTokenPayload): string {
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signature = createHmac('sha256', env.BETTER_AUTH_SECRET).update(encodedPayload).digest('base64url');
	return `${encodedPayload}.${signature}`;
}

function decodeBillingChangeToken(token: string): BillingChangeTokenPayload {
	const [encodedPayload, encodedSignature, extra] = token.split('.');
	if (!encodedPayload || !encodedSignature || extra) {
		throw new CloudBillingManagementConflictError('Billing preview is invalid or expired; request a new preview');
	}
	const expected = createHmac('sha256', env.BETTER_AUTH_SECRET).update(encodedPayload).digest();
	let actual: Buffer;
	try {
		actual = Buffer.from(encodedSignature, 'base64url');
	} catch {
		throw new CloudBillingManagementConflictError('Billing preview is invalid or expired; request a new preview');
	}
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		throw new CloudBillingManagementConflictError('Billing preview is invalid or expired; request a new preview');
	}
	try {
		const payload = JSON.parse(
			Buffer.from(encodedPayload, 'base64url').toString('utf8'),
		) as BillingChangeTokenPayload;
		if (
			payload.version !== 1 ||
			!isCloudBillingPlanKey(payload.targetPlanKey) ||
			!['seat_change', 'plan_change', 'add_member_with_seat'].includes(payload.operation) ||
			!['immediate', 'period_end'].includes(payload.effective)
		) {
			throw new Error('invalid payload');
		}
		return payload;
	} catch {
		throw new CloudBillingManagementConflictError('Billing preview is invalid or expired; request a new preview');
	}
}

async function loadCurrentPaidState(organizationId: string): Promise<CurrentPaidState> {
	const organization = await loadCloudBillingOrganization(organizationId);
	const billing = organization.billing;
	if (
		!billing?.billingPlan ||
		!billing.stripeCustomerId ||
		!billing.stripeSubscriptionId ||
		!billing.stripeSubscriptionItemId ||
		!billing.currentPeriodEndsAt ||
		isTerminalBillingStatus(billing.billingStatus)
	) {
		throw new CloudBillingManagementInputError('No current paid subscription is available');
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
			stripeSubscriptionItemId: billing.stripeSubscriptionItemId,
			currentPeriodEndsAt: billing.currentPeriodEndsAt,
		},
		subscription,
	};
}

async function scheduleCloudPlanChange(
	state: CurrentPaidState,
	targetPlanKey: CloudBillingPlanKey,
	targetQuantity: number,
	requestId: string,
	promotionCodeId?: string,
): Promise<void> {
	await billingQueries.setPendingBillingChange(
		state.organization.id,
		targetPlanKey,
		CLOUD_BILLING_PLANS[targetPlanKey].tier === 'team' ? targetQuantity : null,
	);
	let scheduleId: string | null = null;
	try {
		const created = await createCloudPlanChangeSchedule({
			organizationId: state.organization.id,
			subscription: state.subscription,
			targetPlanKey,
			requestId,
		});
		scheduleId = created.id;
		await billingQueries.attachSubscriptionSchedule(state.organization.id, created.id);
		const schedule = await getCloudPlanChangeSchedule(created.id);
		await updateCloudPlanChangeSchedule({
			schedule,
			targetPlanKey,
			targetQuantity,
			effectiveAt: state.billing.currentPeriodEndsAt,
			promotionCodeId,
		});
	} catch (error) {
		if (scheduleId) {
			try {
				await releaseCloudPlanChangeSchedule(scheduleId);
			} catch (releaseError) {
				logger.error('Failed to release an incompletely configured Stripe schedule', {
					source: 'system',
					context: { scheduleId, error: serializeError(releaseError) },
				});
			}
		}
		await billingQueries.clearPendingBillingChange(state.organization.id);
		throw error;
	}
}

async function replaceCloudPlanChangeSchedule(
	state: CurrentPaidState,
	targetQuantity: number,
	promotionCodeId?: string,
): Promise<void> {
	const scheduleId = state.billing.stripeSubscriptionScheduleId;
	if (!scheduleId || !isSeatOnlyPendingChange(state.billing)) {
		throw new CloudBillingManagementConflictError('Cancel the pending plan change first');
	}
	const previousPlan = state.billing.pendingBillingPlan;
	const previousQuantity = state.billing.pendingSeatQuantity;
	await billingQueries.setPendingBillingChange(state.organization.id, state.billing.billingPlan, targetQuantity);
	try {
		const schedule = await getCloudPlanChangeSchedule(scheduleId);
		await updateCloudPlanChangeSchedule({
			schedule,
			targetPlanKey: requireCurrentPlanKey(state.billing.billingPlan),
			targetQuantity,
			effectiveAt: state.billing.currentPeriodEndsAt,
			promotionCodeId,
		});
	} catch (error) {
		await billingQueries.setPendingBillingChange(
			state.organization.id,
			previousPlan ?? state.billing.billingPlan,
			previousQuantity,
		);
		throw error;
	}
}

async function reconcileAndLoadCommandState(stripeCustomerId: string, organizationId: string) {
	const reconciliation = await reconcileCloudBillingCustomerUnderLock({
		stripeCustomerId,
		organizationIdHint: organizationId,
	});
	if (!reconciliation.applied && !reconciliation.ignored) {
		throw new CloudBillingManagementConflictError(
			'Stripe updated successfully but local billing sync is still pending. Retry after synchronization.',
		);
	}
	const billing = await billingQueries.getOrganizationBilling(organizationId);
	const seatLimit = billing?.billingPlan?.startsWith('cloud_team_') ? billing.seatQuantity : null;
	return {
		billing,
		...(await loadSeatCandidates(organizationId, seatLimit)),
	};
}

async function validateSeatSelection(
	organizationId: string,
	selectedUserIds: string[],
	seatLimit: number,
): Promise<{
	candidates: Awaited<ReturnType<typeof organizationQueries.listOrgSeatCandidates>>;
	selectedIds: Set<string>;
}> {
	const candidates = await organizationQueries.listOrgSeatCandidates(organizationId);
	const admins = candidates.filter(({ membershipClass }) => membershipClass === 'org_admin');
	const selectable = candidates.filter(({ membershipClass }) => membershipClass !== 'org_admin');
	const selectableIds = new Set(selectable.map(({ id }) => id));
	const selectedIds = new Set(selectedUserIds);
	if (selectedIds.size !== selectedUserIds.length || selectedUserIds.some((userId) => !selectableIds.has(userId))) {
		throw new CloudBillingManagementInputError('Seat selection contains an ineligible user');
	}
	const availableSelectionSlots = Math.max(0, seatLimit - admins.length);
	if (selectedIds.size > availableSelectionSlots) {
		throw new CloudBillingManagementInputError('Too many users were selected for the available seats');
	}
	return { candidates, selectedIds };
}

async function createMemberFingerprint(
	organizationId: string,
	userId: string,
	requestedRole: OrgRole,
): Promise<string> {
	const member = await organizationQueries.getOrgMember(organizationId, userId);
	return createHmac('sha256', env.BETTER_AUTH_SECRET)
		.update(JSON.stringify({ organizationId, userId, requestedRole, existingRole: member?.role ?? null }))
		.digest('base64url');
}

async function getMemberSeatTargetQuantity(
	organizationId: string,
	userId: string,
	currentQuantity: number,
): Promise<number> {
	const candidates = await organizationQueries.listOrgSeatCandidates(organizationId);
	const alreadyOccupiesSeat = candidates.some(({ id }) => id === userId);
	return !alreadyOccupiesSeat && candidates.length >= currentQuantity ? currentQuantity + 1 : currentQuantity;
}

async function resolvePromotionCode(
	promotionCode: string | undefined,
	stripeCustomerId: string,
	targetPlanKey: CloudBillingPlanKey,
	targetQuantity: number,
): Promise<CloudPromotionCodeMatch | undefined> {
	if (promotionCode === undefined) {
		return undefined;
	}
	const normalizedCode = promotionCode.trim();
	if (!normalizedCode) {
		throw new CloudBillingManagementInputError('Enter a promotion code');
	}
	const match = await findActiveCloudPromotionCode({
		code: normalizedCode,
		stripeCustomerId,
		targetPlanKey,
		targetQuantity,
	});
	if (!match) {
		throw new CloudBillingManagementInputError('Promotion code is invalid or expired');
	}
	return match;
}

function requireCurrentPlanKey(planKey: string): CloudBillingPlanKey {
	if (!isCloudBillingPlanKey(planKey)) {
		throw new CloudBillingManagementInputError('Legacy subscriptions cannot be changed in-app');
	}
	return planKey;
}

function isImmediatePlanChange(currentPlanKey: CloudBillingPlanKey, targetPlanKey: CloudBillingPlanKey): boolean {
	const current = CLOUD_BILLING_PLANS[currentPlanKey];
	const target = CLOUD_BILLING_PLANS[targetPlanKey];
	if (current.tier !== target.tier) {
		return current.tier === 'team' && target.tier === 'unlimited';
	}
	return current.interval === 'month' && target.interval === 'year';
}

function assertNoBillingCommandConflict(
	billing: CurrentPaidState['billing'],
	allowCancellationScheduled = false,
	allowSeatOnlyPendingChange = false,
): void {
	if (billing.cancellationScheduled && !allowCancellationScheduled) {
		throw new CloudBillingManagementConflictError('Keep your plan before making another billing change');
	}
	if (billing.stripeSubscriptionScheduleId && !(allowSeatOnlyPendingChange && isSeatOnlyPendingChange(billing))) {
		throw new CloudBillingManagementConflictError('Cancel the pending plan change first');
	}
	if (['past_due', 'unpaid', 'paused'].includes(billing.billingStatus ?? '')) {
		throw new CloudBillingManagementInputError('Fix the subscription payment before increasing paid access');
	}
}

function isSeatOnlyPendingChange(billing: CurrentPaidState['billing']): boolean {
	return (
		billing.stripeSubscriptionScheduleId !== null &&
		billing.pendingBillingPlan === billing.billingPlan &&
		billing.pendingSeatQuantity !== null
	);
}

async function runCloudBillingStripeMutation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			'statusCode' in error &&
			(error as { statusCode?: unknown }).statusCode === 402
		) {
			throw new CloudBillingPaymentRequiredError();
		}
		throw error;
	}
}
