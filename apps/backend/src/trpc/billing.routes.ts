import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled } from '../env';
import {
	cancelPendingCloudChangeForAdmin,
	confirmCloudChangeForAdmin,
	keepCloudSubscriptionForAdmin,
	previewCloudChangeForAdmin,
	previewCloudMemberSeatForAdmin,
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
	getCloudBillingAccessForUser,
	getCloudBillingStatusForAdmin,
	getCloudUpcomingInvoiceForAdmin,
	listCloudInvoicesForAdmin,
	resumeCloudSubscriptionForAdmin,
	syncCloudBillingForAdmin,
} from '../services/billing-management.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
} from '../services/stripe.service';
import { CLOUD_BILLING_CURRENCIES, CLOUD_BILLING_PLANS, type CloudBillingPlanKey } from '../types/billing';
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
const planKeyInput = z.enum(Object.keys(CLOUD_BILLING_PLANS) as [CloudBillingPlanKey, ...CloudBillingPlanKey[]]);
const checkoutInput = z.object({
	planKey: planKeyInput,
	seats: z.number().int().optional(),
	currency: currencyInput.default('usd'),
});
const selectedUserIdsInput = z.array(z.string().min(1));
const creditTopUpInput = z.object({
	creditAmountCents: z.number().int().positive(),
	requestId: z.uuid(),
});

export const billingRoutes = {
	getAccess: cloudBillingAccessProcedure.query(({ ctx }) =>
		getCloudBillingAccessForUser({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
			canManageBilling: ctx.orgRole === 'admin',
		}),
	),

	getStatus: cloudBillingAdminProcedure.query(({ ctx }) =>
		getCloudBillingStatusForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		}).catch((error: unknown) => throwBillingFailure('status lookup', 'Unable to load billing status', error)),
	),

	previewChange: cloudBillingAdminProcedure
		.input(
			z.object({
				targetPlanKey: planKeyInput,
				seats: z.number().int().optional(),
				promotionCode: z.string().trim().min(1).max(200).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			previewCloudChangeForAdmin({ ...input, userId: ctx.user.id, organizationId: ctx.organization.id }),
		),

	previewAddMemberWithSeat: cloudBillingAdminProcedure
		.input(
			z
				.object({
					userId: z.string().min(1).optional(),
					email: z.email().optional(),
					role: z.enum(['admin', 'user']),
				})
				.refine((input) => Boolean(input.userId) !== Boolean(input.email), {
					message: 'Provide exactly one of userId or email',
				}),
		)
		.mutation(({ ctx, input }) =>
			previewCloudMemberSeatForAdmin({
				memberUserId: input.userId,
				email: input.email,
				role: input.role,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	confirmChange: cloudBillingAdminProcedure
		.input(z.object({ previewToken: z.string().min(1), requestId: z.uuid() }))
		.mutation(({ ctx, input }) =>
			confirmCloudChangeForAdmin({ ...input, userId: ctx.user.id, organizationId: ctx.organization.id }),
		),

	switchToFree: cloudBillingAdminProcedure
		.input(z.object({ selectedUserIds: selectedUserIdsInput.optional(), requestId: z.uuid() }))
		.mutation(({ ctx, input }) =>
			switchCloudSubscriptionToFreeForAdmin({
				...input,
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			}),
		),

	keepPlan: cloudBillingAdminProcedure
		.input(requestInput)
		.mutation(({ ctx, input }) =>
			keepCloudSubscriptionForAdmin({ ...input, userId: ctx.user.id, organizationId: ctx.organization.id }),
		),

	cancelPendingChange: cloudBillingAdminProcedure.mutation(({ ctx }) =>
		cancelPendingCloudChangeForAdmin({ userId: ctx.user.id, organizationId: ctx.organization.id }),
	),

	selectSeats: cloudBillingAdminProcedure
		.input(z.object({ selectedUserIds: selectedUserIdsInput }))
		.mutation(({ ctx, input }) =>
			selectCloudSeatsForAdmin({ ...input, userId: ctx.user.id, organizationId: ctx.organization.id }),
		),

	createTrialCheckoutSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudTrialCheckoutForAdmin({
				...input,
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
				...input,
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
