import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled, isCloudFreeTierEnabled } from '../env';
import {
	addCloudMemberWithSeatForAdmin,
	cancelPendingCloudPlanChangeForAdmin,
	changeCloudPlanForAdmin,
	changeCloudSeatQuantityForAdmin,
	keepCloudSubscriptionForAdmin,
	previewCloudMemberSeatPurchaseForAdmin,
	previewCloudPlanChangeForAdmin,
	previewCloudSeatChangeForAdmin,
	selectCloudSeatsForAdmin,
	switchCloudSubscriptionToFreeForAdmin,
} from '../services/billing-change.service';
import {
	confirmCreditTopUpForAdmin,
	createCloudPaymentMethodPortalForAdmin,
	createCloudPortalForAdmin,
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	createCreditTopUpCheckoutForAdmin,
	getCloudUpcomingInvoiceForAdmin,
	listCloudInvoicesForAdmin,
	resumeCloudSubscriptionForAdmin,
	syncCloudBillingForAdmin,
} from '../services/billing-management.service';
import {
	getCloudBillingAccess,
	getCloudBillingStatus,
	getLegacyCloudBillingStatus,
} from '../services/billing-status.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
} from '../services/stripe.service';
import {
	CLOUD_BILLING_CURRENCIES,
	CLOUD_BILLING_PLANS,
	type CloudBillingPlanKey,
	CREDIT_TOP_UP_MAX_CENTS,
	CREDIT_TOP_UP_MIN_CENTS,
	TEAM_MAX_SEATS,
	TEAM_MIN_SEATS,
} from '../types/billing';
import type { HandlerErrorCode } from '../utils/error';
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
	seatQuantity: z.number().int().min(TEAM_MIN_SEATS).max(TEAM_MAX_SEATS).optional(),
	currency: currencyInput.default('usd'),
});
const previewTokenInput = z.object({ previewToken: z.string().min(1), requestId: z.uuid() });
const creditTopUpInput = z.object({
	creditAmountCents: z.number().int().min(CREDIT_TOP_UP_MIN_CENTS).max(CREDIT_TOP_UP_MAX_CENTS),
	requestId: z.uuid(),
});

export const billingRoutes = {
	getAccess: cloudBillingAccessProcedure.query(({ ctx }) =>
		getCloudBillingAccess({
			organization: ctx.organization,
			userId: ctx.user.id,
			canManageBilling: ctx.orgRole === 'admin',
		}),
	),

	getStatus: cloudBillingAdminProcedure.input(billingStatusInput).query(async ({ ctx, input }) => {
		const currency = input?.currency ?? 'usd';
		if (isCloudFreeTierEnabled()) {
			return getCloudBillingStatus({ organizationId: ctx.organization.id, userId: ctx.user.id, currency }).catch(
				(error: unknown) => throwBillingFailure('status lookup', 'Unable to load billing status', error),
			);
		}
		return getLegacyCloudBillingStatus(ctx.organization.id, currency).catch((error: unknown) =>
			throwBillingFailure('plan lookup', 'Unable to load billing plans', error),
		);
	}),

	createTrialCheckoutSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudTrialCheckoutForAdmin({
				billingInterval: input.billingInterval,
				planKey: input.planKey,
				seatQuantity: input.seatQuantity,
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
				seatQuantity: input.seatQuantity,
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
		.input(
			z.object({
				targetQuantity: z.number().int().min(TEAM_MIN_SEATS),
				promotionCode: z.string().trim().min(1).max(200).optional(),
			}),
		)
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
				targetSeatQuantity: z.number().int().min(TEAM_MIN_SEATS).optional(),
				promotionCode: z.string().trim().min(1).max(200).optional(),
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
		.mutation(async ({ ctx, input }) =>
			selectCloudSeatsForAdmin({
				...input,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

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
