import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { env, isCloudFreeTierEnabled } from '../env';
import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import { getCreditPurchaseByCheckoutSession } from '../queries/credit-wallet.queries';
import * as organizationQueries from '../queries/organization.queries';
import {
	listOrganizationSeatStates,
	setOrganizationSeatSelection,
	syncOrganizationSeatState,
} from '../queries/organization-seat-state.queries';
import * as userQueries from '../queries/user.queries';
import {
	CLOUD_BILLING_PLANS,
	CLOUD_BILLING_TRIAL_DAYS,
	type CloudBillingCurrency,
	type CloudBillingInterval,
	type CloudBillingPlanKey,
	isCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	TEAM_MIN_SEATS,
} from '../types/billing';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger, serializeError } from '../utils/logger';
import {
	reconcileCloudBillingCustomer,
	reconcileCloudBillingCustomerUnderLock,
} from './billing-reconciliation.service';
import { isActiveTrialWithoutPaidPlan } from './cloud-billing-access.service';
import { createCreditTopUpCheckoutSession, getCreditTopUpPurchase } from './credit-top-up.service';
import { issueCreditPurchase } from './credit-wallet.service';
import { putOrganizationMemberUnderBillingLock } from './membership.service';
import {
	type CloudSubscriptionChangePreview,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPlanChangeSchedule,
	createCloudPortalSession,
	createCloudResubscribeSession,
	getCloudPlanChangeSchedule,
	getCloudSubscription,
	getCloudUpcomingInvoice,
	listCloudInvoices,
	previewCloudSubscriptionChange,
	releaseCloudPlanChangeSchedule,
	resumeCloudSubscription,
	setCloudSubscriptionCancellation,
	updateCloudPlanChangeSchedule,
	updateCloudSubscriptionPlan,
	updateCloudSubscriptionQuantity,
} from './stripe.service';

interface AdminBillingInput {
	userId: string;
	organizationId: string;
}

interface AdminBillingRequestInput extends AdminBillingInput {
	requestId: string;
}

interface AdminBillingCheckoutInput extends AdminBillingInput {
	billingInterval?: CloudBillingInterval;
	planKey?: CloudBillingPlanKey;
	currency: CloudBillingCurrency;
}

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
	prorationDate: string;
	targetPlanKey: CloudBillingPlanKey;
	targetSeatQuantity: number | null;
	operation: BillingChangeOperation;
	memberFingerprint?: string;
	expiresAt: string;
};

export type BillingChangePreview = CloudSubscriptionChangePreview & {
	previewToken: string;
	expiresAt: Date;
	prorationDate: Date;
	effective: 'immediate' | 'period_end';
	effectiveAt: Date;
	targetPlanKey: CloudBillingPlanKey;
	targetSeatQuantity: number | null;
	readOnlyUsersAfterChange: ReturnType<typeof toSeatCandidate>[];
};

export class CloudBillingManagementInputError extends HandlerError {
	constructor(message: string) {
		super('BAD_REQUEST', message);
		this.name = 'CloudBillingManagementInputError';
	}
}

export async function getCloudBillingOrganizationForAdmin(input: AdminBillingInput): Promise<OrganizationWithBilling> {
	return loadCloudBillingOrganization(input.organizationId);
}

export async function createCloudTrialCheckoutForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	if (isCloudFreeTierEnabled()) {
		return withOrganizationBillingLock(input.organizationId, async () => {
			await requireOrganizationAdmin(input);
			const seatUserCount = await organizationQueries.countOrgSeatUsers(input.organizationId);
			const { planKey, quantity } = validateCheckoutPlan(input.planKey, seatUserCount);
			const organization = await loadReconciledCloudBillingOrganizationUnderLock(input.organizationId);
			const trialWithoutPaidPlanActive = isActiveTrialWithoutPaidPlan(organization.billing);
			if (!isTrialAvailable(organization.billing) && !trialWithoutPaidPlanActive) {
				throw new CloudBillingManagementInputError('This organization has already used its free trial');
			}
			const trial =
				trialWithoutPaidPlanActive && organization.billing?.trialEndsAt
					? { trialEnd: organization.billing.trialEndsAt }
					: { trialDays: CLOUD_BILLING_TRIAL_DAYS };
			const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
			return createCloudCheckoutSession({
				planKey,
				quantity,
				currency: input.currency,
				organizationId: organization.id,
				stripeCustomerId,
				...trial,
			});
		});
	}
	const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
	const trialWithoutPaidPlanActive = isActiveTrialWithoutPaidPlan(organization.billing);
	if (!isTrialAvailable(organization.billing) && !trialWithoutPaidPlanActive) {
		throw new CloudBillingManagementInputError('This organization has already used its free trial');
	}
	const trial =
		trialWithoutPaidPlanActive && organization.billing?.trialEndsAt
			? { trialEnd: organization.billing.trialEndsAt }
			: { trialDays: CLOUD_BILLING_TRIAL_DAYS };
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudCheckoutSession({
		billingInterval: input.billingInterval,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		...trial,
	});
}

export async function createCreditTopUpCheckoutForAdmin(
	input: AdminBillingRequestInput & { creditAmountCents: number },
): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCreditTopUpCheckoutSession({
		creditAmountCents: input.creditAmountCents,
		organizationId: organization.id,
		stripeCustomerId,
		initiatingUserId: input.userId,
		requestId: input.requestId,
	});
}

export async function confirmCreditTopUpForAdmin(
	input: AdminBillingInput & { checkoutSessionId: string },
): Promise<boolean> {
	const purchase = await getCreditPurchaseByCheckoutSession(input.checkoutSessionId);
	if (purchase) {
		return purchase.orgId === input.organizationId;
	}
	try {
		return await settleCreditTopUpCheckout(input.checkoutSessionId, input.organizationId);
	} catch (error) {
		logger.warn('Credit top-up confirmation could not settle the Checkout Session', {
			source: 'system',
			context: { checkoutSessionId: input.checkoutSessionId, error: serializeError(error) },
		});
		return false;
	}
}

export async function settleCreditTopUpCheckout(
	checkoutSessionId: string,
	expectedOrganizationId?: string,
): Promise<boolean> {
	const purchase = await getCreditTopUpPurchase(checkoutSessionId);
	if (expectedOrganizationId !== undefined && purchase.organizationId !== expectedOrganizationId) {
		return false;
	}
	const billing = await billingQueries.getOrganizationBilling(purchase.organizationId);
	if (!billing || billing.stripeCustomerId !== purchase.stripeCustomerId) {
		throw new Error(`Stripe Checkout Session "${purchase.checkoutSessionId}" has an unexpected Customer`);
	}
	await issueCreditPurchase({
		checkoutSessionId: purchase.checkoutSessionId,
		paymentIntentId: purchase.paymentIntentId,
		invoiceId: purchase.invoiceId,
		orgId: purchase.organizationId,
		initiatingUserId: purchase.initiatingUserId,
		creditAmountCents: purchase.creditAmountCents,
		platformFeeCents: purchase.platformFeeCents,
		walletAmountMicroUsd: purchase.walletAmountMicroUsd,
		taxAmountCents: purchase.taxAmountCents,
		totalAmountCents: purchase.totalAmountCents,
	});
	return true;
}

export async function listCloudInvoicesForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeCustomerId ? listCloudInvoices(organization.billing.stripeCustomerId) : [];
}

export async function getCloudUpcomingInvoiceForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeSubscriptionId && organization.billing.billingPlan
		? getCloudUpcomingInvoice(organization.billing.stripeSubscriptionId)
		: null;
}

export async function syncCloudBillingForAdmin(input: AdminBillingInput): Promise<{ synced: boolean }> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeCustomerId) {
		return { synced: false };
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: organization.billing.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return { synced: true };
}

export async function createCloudPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (
		!organization.billing?.stripeCustomerId ||
		!organization.billing.stripeSubscriptionId ||
		!organization.billing.billingPlan
	) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to manage');
	}
	return createCloudPortalSession({
		organizationId: organization.id,
		stripeCustomerId: organization.billing.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudPaymentMethodPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeCustomerId || !organization.billing.billingPlan) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to manage');
	}
	return createCloudPaymentMethodSession({
		organizationId: organization.id,
		stripeCustomerId: organization.billing.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudResubscribeForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	if (isCloudFreeTierEnabled()) {
		return withOrganizationBillingLock(input.organizationId, async () => {
			await requireOrganizationAdmin(input);
			const seatUserCount = await organizationQueries.countOrgSeatUsers(input.organizationId);
			const { planKey, quantity } = validateCheckoutPlan(input.planKey, seatUserCount);
			const organization = await loadReconciledCloudBillingOrganizationUnderLock(input.organizationId);
			const billing = organization.billing;
			const isMissingSubscriptionRecovery =
				!billing?.stripeSubscriptionId &&
				Boolean(billing?.billingStatus || billing?.trialStartedAt || billing?.trialEndsAt);
			if (
				billing?.stripeSubscriptionId
					? !billing.stripeCustomerId || !isTerminalBillingStatus(billing.billingStatus)
					: !isMissingSubscriptionRecovery && !isTrialAvailable(billing)
			) {
				throw new CloudBillingManagementInputError('A new subscription is not available');
			}
			const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
			return createCloudResubscribeSession({
				planKey,
				quantity,
				currency: input.currency,
				organizationId: organization.id,
				stripeCustomerId,
				allowMissingHistory: !billing?.stripeSubscriptionId,
			});
		});
	}
	const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
	const billing = organization.billing;
	const isMissingSubscriptionRecovery =
		!billing?.stripeSubscriptionId &&
		Boolean(billing?.billingStatus || billing?.trialStartedAt || billing?.trialEndsAt);
	if (
		billing?.stripeSubscriptionId
			? !billing.stripeCustomerId || !isTerminalBillingStatus(billing.billingStatus)
			: !isMissingSubscriptionRecovery
	) {
		throw new CloudBillingManagementInputError('A new subscription is not available');
	}
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudResubscribeSession({
		billingInterval: input.billingInterval,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		allowMissingHistory: isMissingSubscriptionRecovery,
	});
}

export async function resumeCloudSubscriptionForAdmin(input: AdminBillingRequestInput): Promise<void> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeSubscriptionId || !organization.billing.billingPlan) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to resume');
	}
	await resumeCloudSubscription({
		organizationId: organization.id,
		stripeSubscriptionId: organization.billing.stripeSubscriptionId,
		requestId: input.requestId,
	});
}

export async function previewCloudSeatChangeForAdmin(
	input: AdminBillingInput & { targetQuantity: number },
): Promise<BillingChangePreview> {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		if (!state.billing.billingPlan.startsWith('cloud_team_')) {
			throw new CloudBillingManagementInputError('Seat quantity can only be changed on Team');
		}
		if (input.targetQuantity < TEAM_MIN_SEATS) {
			throw new CloudBillingManagementInputError(`Team requires at least ${TEAM_MIN_SEATS} seats`);
		}
		assertNoBillingCommandConflict(state.billing);
		const targetPlanKey = requireCurrentPlanKey(state.billing.billingPlan);
		return createBillingChangePreview(state, {
			operation: 'seat_change',
			targetPlanKey,
			targetSeatQuantity: input.targetQuantity,
			immediate: true,
		});
	});
}

export async function changeCloudSeatQuantityForAdmin(
	input: AdminBillingInput & { previewToken: string; requestId: string },
) {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const { state, payload } = await verifyBillingChangeToken(input.organizationId, input.previewToken);
		if (payload.operation !== 'seat_change' || payload.targetSeatQuantity === null) {
			throw new CloudBillingManagementConflictError('Billing preview does not authorize a seat change');
		}
		const targetQuantity = payload.targetSeatQuantity;
		await runCloudBillingStripeMutation(() =>
			updateCloudSubscriptionQuantity({
				organizationId: input.organizationId,
				subscription: state.subscription,
				targetQuantity,
				prorationDate: new Date(payload.prorationDate),
				requestId: input.requestId,
			}),
		);
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function previewCloudPlanChangeForAdmin(
	input: AdminBillingInput & { targetPlanKey: CloudBillingPlanKey; targetSeatQuantity?: number },
): Promise<BillingChangePreview> {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		assertNoBillingCommandConflict(state.billing);
		const target = CLOUD_BILLING_PLANS[input.targetPlanKey];
		const targetSeatQuantity = target.tier === 'team' ? validateTeamQuantity(input.targetSeatQuantity) : null;
		const immediate =
			state.subscription.status === 'trialing' ||
			isImmediatePlanChange(requireCurrentPlanKey(state.billing.billingPlan), input.targetPlanKey);
		return createBillingChangePreview(state, {
			operation: 'plan_change',
			targetPlanKey: input.targetPlanKey,
			targetSeatQuantity,
			immediate,
		});
	});
}

export async function changeCloudPlanForAdmin(input: AdminBillingInput & { previewToken: string; requestId: string }) {
	return withOrganizationBillingLock(input.organizationId, async () => {
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
				}),
			);
		} else {
			await scheduleCloudPlanChange(state, payload.targetPlanKey, targetQuantity, input.requestId);
		}
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function switchCloudSubscriptionToFreeForAdmin(
	input: AdminBillingInput & { selectedUserIds?: string[]; requestId?: string },
) {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		if (state.billing.stripeSubscriptionScheduleId) {
			throw new CloudBillingManagementConflictError('Cancel the pending plan change first');
		}
		if (input.selectedUserIds) {
			await saveSeatSelection(input.organizationId, input.selectedUserIds, 3);
		}
		await setCloudSubscriptionCancellation({
			organizationId: input.organizationId,
			subscription: state.subscription,
			cancelAtPeriodEnd: true,
			requestId: input.requestId ?? randomUUID(),
		});
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function keepCloudSubscriptionForAdmin(input: AdminBillingInput & { requestId?: string }) {
	return withOrganizationBillingLock(input.organizationId, async () => {
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
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function cancelPendingCloudPlanChangeForAdmin(input: AdminBillingInput) {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const state = await loadCurrentPaidState(input.organizationId);
		const scheduleId = state.billing.stripeSubscriptionScheduleId;
		if (!scheduleId) {
			throw new CloudBillingManagementConflictError('There is no pending plan change');
		}
		await releaseCloudPlanChangeSchedule(scheduleId);
		await billingQueries.clearPendingBillingChange(input.organizationId);
		return reconcileAndLoadCommandState(state.billing.stripeCustomerId, input.organizationId);
	});
}

export async function selectCloudSeatsForAdmin(
	input: AdminBillingInput & { selectedUserIds: string[]; seatLimit?: number },
) {
	return withOrganizationBillingLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const billing = await billingQueries.getOrganizationBilling(input.organizationId);
		const seatLimit = input.seatLimit ?? billing?.seatQuantity ?? 3;
		await saveSeatSelection(input.organizationId, input.selectedUserIds, seatLimit);
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
	return withOrganizationBillingLock(input.organizationId, async () => {
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
	return withOrganizationBillingLock(input.organizationId, async () => {
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
		const targetSeatQuantity = await getMemberSeatTargetQuantity(
			input.organizationId,
			user.id,
			state.billing.seatQuantity,
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
		memberFingerprint?: string;
	},
): Promise<BillingChangePreview> {
	const prorationDate = new Date();
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
		prorationDate: prorationDate.toISOString(),
		targetPlanKey: target.targetPlanKey,
		targetSeatQuantity: target.targetSeatQuantity,
		operation: target.operation,
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
	};
	if (
		payload.subscriptionId !== baseline.subscriptionId ||
		payload.subscriptionItemId !== baseline.subscriptionItemId ||
		payload.currentPlanKey !== baseline.currentPlanKey ||
		payload.currentSeatQuantity !== baseline.currentSeatQuantity ||
		payload.currency !== baseline.currency ||
		payload.currentPeriodEndsAt !== baseline.currentPeriodEndsAt ||
		payload.billingUpdatedAt !== baseline.billingUpdatedAt
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
			!['seat_change', 'plan_change', 'add_member_with_seat'].includes(payload.operation)
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
		!billing.currentPeriodEndsAt
	) {
		throw new CloudBillingManagementInputError('No current paid subscription is available');
	}
	const subscription = await getCloudSubscription(billing.stripeSubscriptionId);
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

async function saveSeatSelection(organizationId: string, selectedUserIds: string[], seatLimit: number): Promise<void> {
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
	const selectedAt = Date.now();
	await Promise.all(
		selectable.map(({ id }, index) =>
			setOrganizationSeatSelection(organizationId, id, selectedIds.has(id) ? new Date(selectedAt + index) : null),
		),
	);
	const [nextCandidates, states] = await Promise.all([
		organizationQueries.listOrgSeatCandidates(organizationId),
		listOrganizationSeatStates(organizationId),
	]);
	const seatedIds = new Set(
		nextCandidates
			.filter(({ membershipClass, id }) => membershipClass === 'org_admin' || selectedIds.has(id))
			.slice(0, Math.max(0, seatLimit))
			.map(({ id }) => id),
	);
	const changedAt = new Date();
	await Promise.all(
		[...new Set([...nextCandidates.map(({ id }) => id), ...states.map(({ userId }) => userId)])].map((userId) =>
			syncOrganizationSeatState({
				orgId: organizationId,
				userId,
				isReadOnly: !seatedIds.has(userId),
				changedAt,
			}),
		),
	);
}

async function loadSeatCandidates(organizationId: string, seatLimit: number | null) {
	const candidates = await organizationQueries.listOrgSeatCandidates(organizationId);
	const seatedIds = new Set(organizationQueries.resolveSeatedOrgUserIds(candidates, seatLimit));
	const seatCandidates = candidates.map((candidate) => toSeatCandidate(candidate, seatedIds));
	return {
		seatCandidates,
		seatedUsers: seatCandidates.filter(({ isSeated }) => isSeated),
		readOnlyUsers: seatCandidates.filter(({ isReadOnly }) => isReadOnly),
		selectedUserIds: seatCandidates.filter(({ isSelected }) => isSelected).map(({ userId }) => userId),
	};
}

function toSeatCandidate(
	candidate: Awaited<ReturnType<typeof organizationQueries.listOrgSeatCandidates>>[number],
	seatedIds: Set<string> = new Set(),
) {
	const isSeated = seatedIds.has(candidate.id);
	return {
		userId: candidate.id,
		name: candidate.name,
		email: candidate.email,
		membershipClass: candidate.membershipClass,
		storedOrgRole: candidate.orgRole,
		storedProjectRoles: candidate.projectRoles,
		joinedAt: candidate.joinedAt,
		selectedAt: candidate.selectedAt,
		isSelected: candidate.selectedAt !== null,
		isSeated,
		isReadOnly: !isSeated,
	};
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

function validateCheckoutPlan(
	planKey: CloudBillingPlanKey | undefined,
	seatUserCount: number,
): { planKey: CloudBillingPlanKey; quantity: number } {
	if (!planKey) {
		throw new CloudBillingManagementInputError('A billing plan is required');
	}
	const plan = CLOUD_BILLING_PLANS[planKey];
	if (plan.tier === 'team' && seatUserCount < TEAM_MIN_SEATS) {
		throw new CloudBillingManagementInputError(`Team requires at least ${TEAM_MIN_SEATS} seat users`);
	}
	return { planKey, quantity: plan.tier === 'team' ? seatUserCount : 1 };
}

function validateTeamQuantity(quantity: number | undefined): number {
	if (!Number.isInteger(quantity) || quantity === undefined || quantity < TEAM_MIN_SEATS) {
		throw new CloudBillingManagementInputError(`Team requires at least ${TEAM_MIN_SEATS} seats`);
	}
	return quantity;
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

function assertNoBillingCommandConflict(billing: CurrentPaidState['billing']): void {
	if (billing.cancellationScheduled) {
		throw new CloudBillingManagementConflictError('Keep your plan before making another billing change');
	}
	if (billing.stripeSubscriptionScheduleId) {
		throw new CloudBillingManagementConflictError('Cancel the pending plan change first');
	}
	if (['past_due', 'unpaid', 'paused'].includes(billing.billingStatus ?? '')) {
		throw new CloudBillingManagementInputError('Fix the subscription payment before increasing paid access');
	}
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

async function requireOrganizationAdmin(input: AdminBillingInput): Promise<void> {
	const member = await organizationQueries.getOrgMember(input.organizationId, input.userId);
	if (member?.role !== 'admin') {
		throw new HandlerError('FORBIDDEN', 'Only organization admins can manage billing');
	}
}

function withOrganizationBillingLock<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
	return withKeyedLock(`cloud-seats:${organizationId}`, operation);
}

async function loadCloudBillingOrganization(organizationId: string): Promise<OrganizationWithBilling> {
	const organization = await billingQueries.getOrganizationWithBilling(organizationId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return organization;
}

async function loadReconciledCloudBillingOrganization(organizationId: string): Promise<OrganizationWithBilling> {
	const organization = await loadCloudBillingOrganization(organizationId);
	if (!organization.billing?.stripeCustomerId) {
		return organization;
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: organization.billing.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return loadCloudBillingOrganization(organizationId);
}

async function loadReconciledCloudBillingOrganizationUnderLock(
	organizationId: string,
): Promise<OrganizationWithBilling> {
	const organization = await loadCloudBillingOrganization(organizationId);
	if (!organization.billing?.stripeCustomerId) {
		return organization;
	}
	await reconcileCloudBillingCustomerUnderLock({
		stripeCustomerId: organization.billing.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return loadCloudBillingOrganization(organizationId);
}

async function ensureCloudCustomer(organization: OrganizationWithBilling, userId: string): Promise<string> {
	if (organization.billing?.stripeCustomerId) {
		return organization.billing.stripeCustomerId;
	}
	const user = await userQueries.getUser({ id: userId });
	if (!user) {
		throw new Error(`User "${userId}" was not found`);
	}
	const customer = await createCloudCustomer({
		organizationId: organization.id,
		organizationName: organization.name,
		adminEmail: user.email,
	});
	const updated = await billingQueries.attachStripeCustomer(organization.id, customer.id);
	if (!updated.stripeCustomerId) {
		throw new Error('Unable to attach Stripe Customer');
	}
	return updated.stripeCustomerId;
}
