import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import * as orgQueries from '../queries/organization.queries';
import {
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
	CloudTrialUnavailableError,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
	listCloudInvoices,
	resumeCloudSubscription,
} from '../services/stripe.service';
import { CLOUD_MONTHLY_PLAN } from '../types/billing';
import { logger } from '../utils/logger';
import { protectedProcedure } from './trpc';

const cloudBillingMemberProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	if (!isCloudBillingEnabled()) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	const membership = await orgQueries.getUserOrgMembership(ctx.user.id);
	if (!membership) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
	}

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
	getStatus: cloudBillingMemberProcedure.query(({ ctx }) => ({
		plan: ctx.organization.billingPlan === CLOUD_MONTHLY_PLAN.key ? CLOUD_MONTHLY_PLAN : null,
		availablePlan: CLOUD_MONTHLY_PLAN,
		planKey: ctx.organization.billingPlan,
		status: ctx.organization.billingStatus,
		trialStartedAt: ctx.organization.trialStartedAt,
		trialEndsAt: ctx.organization.trialEndsAt,
		currentPeriodEndsAt: ctx.organization.currentPeriodEndsAt,
		cancelAtPeriodEnd: ctx.organization.cancelAtPeriodEnd,
		billingAccessEndsAt: ctx.organization.billingAccessEndsAt,
		canManageBilling: ctx.orgRole === 'admin',
		trialAvailable: !ctx.organization.trialStartedAt && !ctx.organization.stripeSubscriptionId,
		portalAvailable: Boolean(ctx.organization.stripeCustomerId && ctx.organization.stripeSubscriptionId),
		invoiceHistoryAvailable: Boolean(ctx.organization.stripeCustomerId),
		paymentMethodManagementAvailable: Boolean(ctx.organization.stripeCustomerId),
		resubscribeAvailable:
			Boolean(ctx.organization.stripeCustomerId && ctx.organization.stripeSubscriptionId) &&
			['canceled', 'incomplete_expired'].includes(ctx.organization.billingStatus ?? ''),
		subscriptionConfirmed: Boolean(ctx.organization.stripeSubscriptionId),
	})),

	getInvoices: cloudBillingAdminProcedure.query(async ({ ctx }) => {
		if (!ctx.organization.stripeCustomerId) {
			return [];
		}
		try {
			return await listCloudInvoices(ctx.organization.stripeCustomerId);
		} catch (error) {
			logBillingFailure('invoice history', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to load Stripe invoices' });
		}
	}),

	createCheckoutSession: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		if (ctx.organization.trialStartedAt || ctx.organization.stripeSubscriptionId) {
			throw new TRPCError({ code: 'CONFLICT', message: 'This organization has already used its cloud trial' });
		}

		try {
			let stripeCustomerId = ctx.organization.stripeCustomerId;
			if (!stripeCustomerId) {
				const customer = await createCloudCustomer({
					organizationId: ctx.organization.id,
					organizationName: ctx.organization.name,
					adminEmail: ctx.user.email,
				});
				stripeCustomerId = (await billingQueries.attachStripeCustomer(ctx.organization.id, customer.id))
					.stripeCustomerId;
			}
			if (!stripeCustomerId) {
				throw new Error('Unable to attach Stripe Customer');
			}

			const url = await createCloudCheckoutSession({
				organizationId: ctx.organization.id,
				stripeCustomerId,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudTrialUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			logBillingFailure('Checkout', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to start Stripe Checkout' });
		}
	}),

	createPortalSession: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		if (!ctx.organization.stripeCustomerId || !ctx.organization.stripeSubscriptionId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'No Stripe subscription is available to manage' });
		}
		try {
			const url = await createCloudPortalSession({
				organizationId: ctx.organization.id,
				stripeCustomerId: ctx.organization.stripeCustomerId,
				requestId: input.requestId,
			});
			return { url };
		} catch (error) {
			logBillingFailure('Customer Portal', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to open Stripe billing' });
		}
	}),

	createPaymentMethodSession: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		if (!ctx.organization.stripeCustomerId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'No Stripe Customer is available to manage' });
		}
		try {
			const url = await createCloudPaymentMethodSession({
				organizationId: ctx.organization.id,
				stripeCustomerId: ctx.organization.stripeCustomerId,
				requestId: input.requestId,
			});
			return { url };
		} catch (error) {
			logBillingFailure('payment method management', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to manage payment methods' });
		}
	}),

	createResubscribeSession: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		if (
			!ctx.organization.stripeCustomerId ||
			!ctx.organization.stripeSubscriptionId ||
			!['canceled', 'incomplete_expired'].includes(ctx.organization.billingStatus ?? '')
		) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'A new subscription is not available' });
		}
		try {
			const url = await createCloudResubscribeSession({
				organizationId: ctx.organization.id,
				stripeCustomerId: ctx.organization.stripeCustomerId,
				requestId: input.requestId,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudSubscriptionUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			logBillingFailure('subscription Checkout', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to start Stripe Checkout' });
		}
	}),

	resumeSubscription: cloudBillingAdminProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
		if (!ctx.organization.stripeSubscriptionId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'No Stripe subscription is available to resume' });
		}
		try {
			await resumeCloudSubscription({
				organizationId: ctx.organization.id,
				stripeSubscriptionId: ctx.organization.stripeSubscriptionId,
				requestId: input.requestId,
			});
			return { pending: true as const };
		} catch (error) {
			if (error instanceof CloudSubscriptionResumeError) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
			}
			logBillingFailure('subscription resume', error);
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to resume the subscription' });
		}
	}),
};

function logBillingFailure(action: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	logger.error(`Stripe ${action} failed: ${message}`, { source: 'system' });
}
