import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled } from '../env';
import {
	createCloudCheckoutForAdmin,
	createCloudPaymentMethodPortalForAdmin,
	createCloudPortalForAdmin,
	createCloudResubscribeForAdmin,
	getCloudBillingOrganizationForAdmin,
	listCloudInvoicesForAdmin,
	resumeCloudSubscriptionForAdmin,
	syncCloudBillingForAdmin,
} from '../services/billing-management.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
} from '../services/stripe.service';
import { CLOUD_MONTHLY_PLAN } from '../types/billing';
import type { HandlerErrorCode } from '../utils/error';
import { logger } from '../utils/logger';
import { protectedProcedure, resolveOrganizationMembership } from './trpc';

const cloudBillingMemberProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	if (!isCloudBillingEnabled()) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	const membership = await resolveOrganizationMembership(ctx.user.id, ctx.selectedProjectId);

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

const requestInput = z.object({ requestId: z.uuid() });

export const billingRoutes = {
	getStatus: cloudBillingAdminProcedure.query(async ({ ctx }) => {
		const organization = await getCloudBillingOrganizationForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		});
		return {
			plan: organization.billingPlan === CLOUD_MONTHLY_PLAN.key ? CLOUD_MONTHLY_PLAN : null,
			availablePlan: CLOUD_MONTHLY_PLAN,
			planKey: organization.billingPlan,
			status: organization.billingStatus,
			trialStartedAt: organization.trialStartedAt,
			trialEndsAt: organization.trialEndsAt,
			currentPeriodEndsAt: organization.currentPeriodEndsAt,
			cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
			hasDefaultPaymentMethod: organization.hasDefaultPaymentMethod,
			billingAccessEndsAt: organization.billingAccessEndsAt,
			canManageBilling: true,
			localTrialActive:
				organization.billingStatus === 'trialing' &&
				Boolean(organization.trialEndsAt && organization.trialEndsAt.getTime() > Date.now()) &&
				!organization.stripeSubscriptionId,
			portalAvailable: Boolean(organization.stripeCustomerId && organization.stripeSubscriptionId),
			invoiceHistoryAvailable: Boolean(organization.stripeCustomerId),
			paymentMethodManagementAvailable: Boolean(organization.stripeCustomerId),
			resubscribeAvailable:
				Boolean(organization.stripeCustomerId && organization.stripeSubscriptionId) &&
				['canceled', 'incomplete_expired'].includes(organization.billingStatus ?? ''),
			hasStripeSubscription: Boolean(organization.stripeSubscriptionId),
		};
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

	createCheckoutSession: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		try {
			const url = await createCloudCheckoutForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudInitialCheckoutUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			throwBillingFailure('Checkout', 'Unable to start Stripe Checkout', error);
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

	createResubscribeSession: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		try {
			const url = await createCloudResubscribeForAdmin({
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
	return code === 'BAD_REQUEST' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'NOT_FOUND'
		? code
		: null;
}
