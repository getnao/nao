import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled, isCloudFreeTierEnabled } from '../env';
import { getOrganizationBilling } from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import {
	addCloudMemberWithSeatForAdmin,
	cancelPendingCloudPlanChangeForAdmin,
	changeCloudPlanForAdmin,
	changeCloudSeatQuantityForAdmin,
	confirmCreditTopUpForAdmin,
	createCloudPaymentMethodPortalForAdmin,
	createCloudPortalForAdmin,
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	createCreditTopUpCheckoutForAdmin,
	getCloudBillingOrganizationForAdmin,
	getCloudUpcomingInvoiceForAdmin,
	keepCloudSubscriptionForAdmin,
	listCloudInvoicesForAdmin,
	previewCloudMemberSeatPurchaseForAdmin,
	previewCloudPlanChangeForAdmin,
	previewCloudSeatChangeForAdmin,
	resumeCloudSubscriptionForAdmin,
	selectCloudSeatsForAdmin,
	switchCloudSubscriptionToFreeForAdmin,
	syncCloudBillingForAdmin,
} from '../services/billing-management.service';
import {
	getOrganizationCloudEntitlement,
	isActiveLocalTrial,
	isActiveTrialWithoutPaidPlan,
	isExpiredTrialWithoutPaidPlan,
	isUserReadOnlyInOrganization,
} from '../services/cloud-billing-access.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
	getCloudBillingPlans,
	getCloudSubscriptionCurrency,
	getCurrentCloudBillingPlans,
} from '../services/stripe.service';
import {
	CLOUD_BILLING_CURRENCIES,
	CLOUD_BILLING_PLANS,
	type CloudBillingPlanKey,
	CREDIT_TOP_UP_MAX_CENTS,
	CREDIT_TOP_UP_MIN_CENTS,
	isCloudBillingPlanKey,
	isLegacyCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	LEGACY_CLOUD_BILLING_PLANS,
} from '../types/billing';
import { HandlerError, type HandlerErrorCode } from '../utils/error';
import { logger } from '../utils/logger';
import { publicProcedure, resolveOrganizationMembership } from './trpc';

const cloudBillingProcedure = publicProcedure.use(async ({ ctx, next }) => {
	if (!isCloudBillingEnabled()) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}

	return next({ ctx: { user: ctx.session.user } });
});

const cloudBillingMemberProcedure = cloudBillingProcedure.use(async ({ ctx, next }) => {
	const membership = await resolveOrganizationMembership(
		ctx.user.id,
		ctx.selectedProjectId,
		ctx.selectedOrganizationId,
	);

	return next({
		ctx: {
			organization: membership.organization,
			orgRole: membership.role,
		},
	});
});

const cloudBillingAdminProcedure = cloudBillingMemberProcedure.use(async ({ ctx, next }) => {
	if (ctx.orgRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can manage billing' });
	}
	return next({ ctx });
});

const cloudFreeTierAdminProcedure = cloudBillingAdminProcedure.use(async ({ ctx, next }) => {
	if (!isCloudFreeTierEnabled()) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	return next({ ctx });
});

const cloudBillingAccessProcedure = cloudBillingProcedure.use(async ({ ctx, next }) => {
	const membership = await resolveOrganizationMembership(
		ctx.user.id,
		ctx.selectedProjectId,
		ctx.selectedProjectId ? null : ctx.selectedOrganizationId,
	);

	return next({
		ctx: {
			organization: membership.organization,
			orgRole: membership.role,
		},
	});
});

const requestInput = z.object({ requestId: z.uuid() });
const currencyInput = z.enum(CLOUD_BILLING_CURRENCIES);
const billingStatusInput = z.object({ currency: currencyInput }).optional();
const checkoutInput = z.object({
	billingInterval: z.enum(['monthly', 'yearly']).optional(),
	planKey: z.enum(Object.keys(CLOUD_BILLING_PLANS) as [CloudBillingPlanKey, ...CloudBillingPlanKey[]]).optional(),
	currency: currencyInput.default('usd'),
});
const previewTokenInput = z.object({ previewToken: z.string().min(1), requestId: z.uuid() });
const creditTopUpInput = z.object({
	creditAmountCents: z.number().int().min(CREDIT_TOP_UP_MIN_CENTS).max(CREDIT_TOP_UP_MAX_CENTS),
	requestId: z.uuid(),
});

export const billingRoutes = {
	getAccess: cloudBillingAccessProcedure.query(async ({ ctx }) => {
		const billing = await getOrganizationBilling(ctx.organization.id);
		const freeTierEnabled = isCloudFreeTierEnabled();
		const entitlement = await getOrganizationCloudEntitlement(ctx.organization.id);
		if (!entitlement) {
			throw new TRPCError({ code: 'NOT_FOUND' });
		}
		return {
			organizationId: ctx.organization.id,
			hasAccess: entitlement.hasAccess,
			bypassBilling: ctx.organization.bypassBilling,
			canManageBilling: ctx.orgRole === 'admin',
			tier: entitlement.tier,
			status: billing?.billingStatus ?? null,
			billingPlan: billing?.billingPlan ?? null,
			trialEndsAt: billing?.trialEndsAt ?? null,
			accessEndsAt: entitlement.paidAccessEndsAt,
			seatUserCount: entitlement.seatUserCount,
			seatQuantity: entitlement.seatQuantity,
			seatLimit: entitlement.seatLimit,
			availableSeats: entitlement.availableSeats,
			overCapacity: entitlement.overCapacity,
			isReadOnly: await isUserReadOnlyInOrganization(ctx.organization.id, ctx.user.id, entitlement),
			trialAvailable: isTrialAvailable(billing),
			requiresBillingAction:
				billing?.billingStatus === 'trialing' &&
				billing.hasDefaultPaymentMethod !== true &&
				(!freeTierEnabled || entitlement.seatUserCount > 3),
			freeTierEnabled,
		};
	}),

	getStatus: cloudBillingAdminProcedure.input(billingStatusInput).query(async ({ ctx, input }) => {
		const organization = await getCloudBillingOrganizationForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		});
		if (isCloudFreeTierEnabled()) {
			return getCanonicalBillingStatus(organization, ctx.user.id, input?.currency ?? 'usd').catch(
				(error: unknown) => throwBillingFailure('status lookup', 'Unable to load billing status', error),
			);
		}
		const billing = organization.billing;
		const trialAvailable = isTrialAvailable(billing);
		const localTrialActive = isActiveLocalTrial(billing);
		const needsPaidPlanSelection = isActiveTrialWithoutPaidPlan(billing);
		const expiredTrialWithoutPaidPlan = isExpiredTrialWithoutPaidPlan(billing);
		const paidPlanSelected = Boolean(billing?.stripeSubscriptionId && billing.billingPlan);
		const { availablePlans, subscriptionPlan } = await (async () => {
			const subscriptionCurrency =
				paidPlanSelected && billing?.stripeSubscriptionId
					? await getCloudSubscriptionCurrency(billing.stripeSubscriptionId)
					: null;
			return getCloudBillingPlans(
				paidPlanSelected ? (billing?.stripePriceId ?? null) : null,
				input?.currency ?? 'usd',
				subscriptionCurrency,
			);
		})().catch((error: unknown) => throwBillingFailure('plan lookup', 'Unable to load billing plans', error));
		const projectedPlan =
			subscriptionPlan ?? Object.values(availablePlans).find((plan) => plan.key === billing?.billingPlan) ?? null;
		return {
			plan: projectedPlan,
			availablePlans,
			planKey: billing?.billingPlan ?? null,
			status: billing?.billingStatus ?? null,
			trialStartedAt: billing?.trialStartedAt ?? null,
			trialEndsAt: billing?.trialEndsAt ?? null,
			currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
			cancellationScheduled: billing?.cancellationScheduled ?? null,
			hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? null,
			billingAccessEndsAt: billing?.billingAccessEndsAt ?? null,
			canManageBilling: true,
			trialAvailable,
			needsPaidPlanSelection,
			paidPlanSelected,
			portalAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
			invoiceHistoryAvailable: Boolean(billing?.stripeCustomerId),
			paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
			resubscribeAvailable:
				expiredTrialWithoutPaidPlan ||
				(!billing?.stripeSubscriptionId && !trialAvailable && !localTrialActive) ||
				(Boolean(billing?.stripeCustomerId && billing.stripeSubscriptionId) &&
					isTerminalBillingStatus(billing?.billingStatus)),
			hasStripeSubscription: Boolean(billing?.stripeSubscriptionId),
		};
	}),

	createTrialCheckoutSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudTrialCheckoutForAdmin({
				billingInterval: input.billingInterval,
				planKey: input.planKey,
				currency: input.currency,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudInitialCheckoutUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			throwBillingFailure('plan Checkout', 'Unable to open Stripe Checkout', error);
		}
	}),

	createCreditTopUpCheckoutSession: cloudBillingAdminProcedure
		.input(creditTopUpInput)
		.mutation(async ({ ctx, input }) => {
			try {
				const url = await createCreditTopUpCheckoutForAdmin({
					...input,
					userId: ctx.user.id,
					organizationId: ctx.organization.id,
				});
				return { url };
			} catch (error) {
				throwBillingFailure('credit top-up Checkout', 'Unable to start credit Checkout', error);
			}
		}),

	confirmCreditTopUp: cloudBillingAdminProcedure
		.input(z.object({ checkoutSessionId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			try {
				const credited = await confirmCreditTopUpForAdmin({
					userId: ctx.user.id,
					organizationId: ctx.organization.id,
					checkoutSessionId: input.checkoutSessionId,
				});
				return { credited };
			} catch (error) {
				throwBillingFailure('credit top-up confirmation', 'Unable to confirm credit Checkout', error);
			}
		}),

	getInvoices: cloudBillingAdminProcedure.query(async ({ ctx }) => {
		try {
			return await listCloudInvoicesForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
		} catch (error) {
			throwBillingFailure('invoice history', 'Unable to load Stripe invoices', error);
		}
	}),

	getUpcomingInvoice: cloudBillingAdminProcedure.query(async ({ ctx }) => {
		try {
			return await getCloudUpcomingInvoiceForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
		} catch (error) {
			throwBillingFailure('upcoming invoice preview', 'Unable to load the next Stripe payment', error);
		}
	}),

	syncStripeBilling: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		try {
			return await syncCloudBillingForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
		} catch (error) {
			throwBillingFailure('billing sync', 'Unable to sync Stripe billing status', error);
		}
	}),

	createPortalSession: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudPortalForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
				requestId: input.requestId,
			});
			return { url };
		} catch (error) {
			throwBillingFailure('Customer Portal', 'Unable to open Stripe billing', error);
		}
	}),

	createPaymentMethodSession: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudPaymentMethodPortalForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
				requestId: input.requestId,
			});
			return { url };
		} catch (error) {
			throwBillingFailure('payment method management', 'Unable to manage payment methods', error);
		}
	}),

	createResubscribeSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudResubscribeForAdmin({
				billingInterval: input.billingInterval,
				planKey: input.planKey,
				currency: input.currency,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudSubscriptionUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			throwBillingFailure('subscription Checkout', 'Unable to start Stripe Checkout', error);
		}
	}),

	previewSeatChange: cloudFreeTierAdminProcedure
		.input(z.object({ targetQuantity: z.number().int().min(4) }))
		.mutation(async ({ ctx, input }) =>
			previewCloudSeatChangeForAdmin({
				...input,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	changeSeatQuantity: cloudFreeTierAdminProcedure.input(previewTokenInput).mutation(async ({ ctx, input }) =>
		changeCloudSeatQuantityForAdmin({
			...input,
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		}),
	),

	previewPlanChange: cloudFreeTierAdminProcedure
		.input(
			z.object({
				targetPlanKey: z.enum(
					Object.keys(CLOUD_BILLING_PLANS) as [CloudBillingPlanKey, ...CloudBillingPlanKey[]],
				),
				targetSeatQuantity: z.number().int().min(4).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) =>
			previewCloudPlanChangeForAdmin({
				...input,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	changePlan: cloudFreeTierAdminProcedure.input(previewTokenInput).mutation(async ({ ctx, input }) =>
		changeCloudPlanForAdmin({
			...input,
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		}),
	),

	previewAddMemberWithSeat: cloudFreeTierAdminProcedure
		.input(
			z
				.object({
					userId: z.string().min(1).optional(),
					email: z.email().optional(),
					requestedRole: z.enum(['admin', 'user']),
				})
				.refine((input) => Boolean(input.userId) !== Boolean(input.email), {
					message: 'Provide exactly one of userId or email',
				}),
		)
		.mutation(async ({ ctx, input }) =>
			previewCloudMemberSeatPurchaseForAdmin({
				memberUserId: input.userId,
				email: input.email,
				requestedRole: input.requestedRole,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	addMemberWithSeat: cloudFreeTierAdminProcedure
		.input(
			z
				.object({
					userId: z.string().min(1).optional(),
					email: z.email().optional(),
					requestedRole: z.enum(['admin', 'user']),
					previewToken: z.string().min(1),
					requestId: z.uuid(),
				})
				.refine((input) => Boolean(input.userId) !== Boolean(input.email), {
					message: 'Provide exactly one of userId or email',
				}),
		)
		.mutation(async ({ ctx, input }) =>
			addCloudMemberWithSeatForAdmin({
				memberUserId: input.userId,
				email: input.email,
				requestedRole: input.requestedRole,
				previewToken: input.previewToken,
				requestId: input.requestId,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	selectSeats: cloudFreeTierAdminProcedure
		.input(z.object({ selectedUserIds: z.array(z.string().min(1)) }))
		.mutation(async ({ ctx, input }) => {
			const entitlement = await getOrganizationCloudEntitlement(ctx.organization.id);
			const seatLimit = entitlement?.tier === 'trial' ? entitlement.seatUserCount : entitlement?.seatLimit;
			if (seatLimit === null || seatLimit === undefined) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'This plan does not use seat assignments' });
			}
			return selectCloudSeatsForAdmin({
				...input,
				seatLimit,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
		}),

	switchToFree: cloudFreeTierAdminProcedure
		.input(z.object({ selectedUserIds: z.array(z.string().min(1)).optional() }))
		.mutation(async ({ ctx, input }) =>
			switchCloudSubscriptionToFreeForAdmin({
				...input,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	keepPlan: cloudFreeTierAdminProcedure.mutation(async ({ ctx }) =>
		keepCloudSubscriptionForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		}),
	),

	cancelPendingPlanChange: cloudFreeTierAdminProcedure.mutation(async ({ ctx }) =>
		cancelPendingCloudPlanChangeForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		}),
	),

	resumeSubscription: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		try {
			await resumeCloudSubscriptionForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
				requestId: input.requestId,
			});
			return { pending: true as const };
		} catch (error) {
			if (error instanceof CloudSubscriptionResumeError) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
			}
			throwBillingFailure('subscription resume', 'Unable to resume the subscription', error);
		}
	}),
};

async function getCanonicalBillingStatus(
	organization: Awaited<ReturnType<typeof getCloudBillingOrganizationForAdmin>>,
	userId: string,
	currency: (typeof CLOUD_BILLING_CURRENCIES)[number],
) {
	const billing = organization.billing;
	const entitlement = await getOrganizationCloudEntitlement(organization.id);
	if (!entitlement) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	const [availablePlans, candidates, subscriptionCurrency] = await Promise.all([
		getCurrentCloudBillingPlans(currency),
		organizationQueries.listOrgSeatCandidates(organization.id),
		billing?.stripeSubscriptionId && billing.billingPlan
			? getCloudSubscriptionCurrency(billing.stripeSubscriptionId)
			: Promise.resolve(null),
	]);
	const effectiveSeatLimit =
		entitlement.tier === 'team' && entitlement.seatQuantity === null
			? 0
			: entitlement.tier === 'trial'
				? entitlement.seatUserCount
				: entitlement.seatLimit;
	const seatedIds = new Set(organizationQueries.resolveSeatedOrgUserIds(candidates, effectiveSeatLimit));
	const seatCandidates = candidates.map((candidate) => ({
		userId: candidate.id,
		name: candidate.name,
		email: candidate.email,
		membershipClass: candidate.membershipClass,
		storedOrgRole: candidate.orgRole,
		storedProjectRoles: candidate.projectRoles,
		joinedAt: candidate.joinedAt,
		selectedAt: candidate.selectedAt,
		isSelected: candidate.selectedAt !== null,
		isSeated: seatedIds.has(candidate.id),
		isReadOnly: !seatedIds.has(candidate.id),
	}));
	const currentDefinition = billing?.billingPlan
		? isCloudBillingPlanKey(billing.billingPlan)
			? CLOUD_BILLING_PLANS[billing.billingPlan]
			: isLegacyCloudBillingPlanKey(billing.billingPlan)
				? LEGACY_CLOUD_BILLING_PLANS[billing.billingPlan]
				: null
		: null;
	const pendingDefinition =
		billing?.pendingBillingPlan && isCloudBillingPlanKey(billing.pendingBillingPlan)
			? CLOUD_BILLING_PLANS[billing.pendingBillingPlan]
			: null;
	const access = {
		organizationId: organization.id,
		hasAccess: entitlement.hasAccess,
		bypassBilling: organization.bypassBilling,
		canManageBilling: true,
		tier: entitlement.tier,
		status: billing?.billingStatus ?? null,
		billingPlan: billing?.billingPlan ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		accessEndsAt: entitlement.paidAccessEndsAt,
		seatUserCount: entitlement.seatUserCount,
		seatQuantity: entitlement.seatQuantity,
		seatLimit: entitlement.seatLimit,
		availableSeats: entitlement.availableSeats,
		overCapacity: entitlement.overCapacity,
		isReadOnly: await isUserReadOnlyInOrganization(organization.id, userId, entitlement),
		trialAvailable: isTrialAvailable(billing),
		requiresBillingAction:
			billing?.billingStatus === 'trialing' &&
			billing.hasDefaultPaymentMethod !== true &&
			entitlement.seatUserCount > 3,
		freeTierEnabled: true,
	};
	const requiredTeamQuantity = Math.max(4, entitlement.seatUserCount);
	const monthlyTeam = availablePlans.find((plan) => plan.tier === 'team' && plan.interval === 'monthly');
	const monthlyUnlimited = availablePlans.find((plan) => plan.tier === 'unlimited' && plan.interval === 'monthly');
	const yearlyUnlimited = availablePlans.find((plan) => plan.tier === 'unlimited' && plan.interval === 'yearly');
	if (!monthlyUnlimited || !yearlyUnlimited) {
		throw new Error('Stripe did not return both Unlimited billing intervals');
	}
	const compatibleAvailablePlans = Object.assign(availablePlans, {
		monthly: toLegacyCompatiblePlan(monthlyUnlimited),
		yearly: toLegacyCompatiblePlan(yearlyUnlimited),
	});
	const currentOffer = billing?.billingPlan
		? availablePlans.find(({ planKey }) => planKey === billing.billingPlan)
		: undefined;
	const paidPlanSelected = Boolean(billing?.stripeSubscriptionId && billing.billingPlan);
	const trialAvailable = isTrialAvailable(billing);
	const localTrialActive = isActiveLocalTrial(billing);
	const expiredTrialWithoutPaidPlan = isExpiredTrialWithoutPaidPlan(billing);
	return {
		access,
		plan: currentOffer ? toLegacyCompatiblePlan(currentOffer) : null,
		planKey: billing?.billingPlan ?? null,
		status: billing?.billingStatus ?? null,
		trialStartedAt: billing?.trialStartedAt ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		billingAccessEndsAt: billing?.billingAccessEndsAt ?? null,
		canManageBilling: true,
		trialAvailable,
		needsPaidPlanSelection: isActiveTrialWithoutPaidPlan(billing),
		paidPlanSelected,
		resubscribeAvailable:
			expiredTrialWithoutPaidPlan ||
			(!billing?.stripeSubscriptionId && !trialAvailable && !localTrialActive) ||
			(Boolean(billing?.stripeCustomerId && billing.stripeSubscriptionId) &&
				isTerminalBillingStatus(billing?.billingStatus)),
		hasStripeSubscription: Boolean(billing?.stripeSubscriptionId),
		billingUpdatedAt: billing?.billingUpdatedAt ?? null,
		currentPeriodStartsAt: billing?.currentPeriodStartsAt ?? null,
		currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
		cancellationScheduled: billing?.cancellationScheduled ?? false,
		scheduleConflict: Boolean(billing?.stripeSubscriptionScheduleId),
		current: currentDefinition
			? {
					planKey: currentDefinition.key,
					tier: currentDefinition.tier,
					interval: currentDefinition.interval === 'month' ? ('monthly' as const) : ('yearly' as const),
					legacy: 'legacy' in currentDefinition && currentDefinition.legacy === true,
					currency: subscriptionCurrency ?? currency,
					seatQuantity: billing?.seatQuantity ?? null,
				}
			: null,
		pending: pendingDefinition
			? {
					planKey: pendingDefinition.key,
					tier: pendingDefinition.tier,
					interval: pendingDefinition.interval === 'month' ? ('monthly' as const) : ('yearly' as const),
					seatQuantity: billing?.pendingSeatQuantity ?? null,
					effectiveAt: billing?.currentPeriodEndsAt ?? null,
				}
			: null,
		availablePlans: compatibleAvailablePlans,
		seatCandidates,
		seatedUsers: seatCandidates.filter(({ isSeated }) => isSeated),
		readOnlyUsers: seatCandidates.filter(({ isReadOnly }) => isReadOnly),
		selectedUserIds: seatCandidates.filter(({ isSelected }) => isSelected).map(({ userId: id }) => id),
		recommendation:
			monthlyTeam && monthlyUnlimited
				? monthlyTeam.unitAmount * requiredTeamQuantity >= monthlyUnlimited.unitAmount
					? 'unlimited'
					: 'team'
				: null,
		hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? null,
		portalAvailable: Boolean(billing?.stripeCustomerId && billing.billingPlan),
		invoiceHistoryAvailable: Boolean(billing?.stripeCustomerId),
		paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId && billing.billingPlan),
	};
}

function toLegacyCompatiblePlan(plan: Awaited<ReturnType<typeof getCurrentCloudBillingPlans>>[number]) {
	const definition = CLOUD_BILLING_PLANS[plan.planKey];
	return {
		key: plan.planKey,
		name: definition.name,
		amount: plan.unitAmount,
		currency: plan.currency,
		interval: definition.interval,
		intervalCount: definition.intervalCount,
		trialDays: definition.trialDays,
		userLimit: definition.userLimit,
		tier: definition.tier,
		perSeat: definition.perSeat,
	};
}

function throwBillingFailure(action: string, publicMessage: string, error: unknown): never {
	const handlerCode = getHandlerErrorCode(error);
	if (handlerCode) {
		const message = error instanceof Error ? error.message : publicMessage;
		throw new TRPCError({ code: handlerCode, message });
	}
	const message = error instanceof Error ? error.message : String(error);
	logger.error(`Stripe ${action} failed: ${message}`, { source: 'system' });
	throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: publicMessage });
}

function getHandlerErrorCode(error: unknown): HandlerErrorCode | null {
	if (typeof error !== 'object' || error === null || !('codeMessage' in error)) {
		return null;
	}
	const code = error.codeMessage;
	return code === 'BAD_REQUEST' ||
		code === 'UNAUTHORIZED' ||
		code === 'FORBIDDEN' ||
		code === 'NOT_FOUND' ||
		code === 'CONFLICT'
		? code
		: null;
}
