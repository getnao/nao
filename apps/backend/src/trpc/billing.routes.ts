import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { isCloudBillingEnabled } from '../env';
import { getOrganizationBilling } from '../queries/billing.queries';
import {
	createCloudPaymentMethodPortalForAdmin,
	createCloudPortalForAdmin,
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	getCloudBillingOrganizationForAdmin,
	getCloudUpcomingInvoiceForAdmin,
	listCloudInvoicesForAdmin,
	resumeCloudSubscriptionForAdmin,
	syncCloudBillingForAdmin,
} from '../services/billing-management.service';
import { hasCloudBillingAccess } from '../services/cloud-billing-access.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
	getCloudBillingPlans,
} from '../services/stripe.service';
import { CLOUD_MONTHLY_PLAN, isTerminalBillingStatus } from '../types/billing';
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

const cloudBillingAdminProcedure = cloudBillingMemberProcedure.use(async ({ ctx, next }) => {
	if (ctx.orgRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can manage billing' });
	}
	return next({ ctx });
});

const requestInput = z.object({ requestId: z.uuid() });

export const billingRoutes = {
	getAccess: cloudBillingAccessProcedure.query(async ({ ctx }) => {
		const billing = await getOrganizationBilling(ctx.organization.id);
		return {
			organizationId: ctx.organization.id,
			hasAccess: hasCloudBillingAccess(billing),
			status: billing?.billingStatus ?? null,
			trialEndsAt: billing?.trialEndsAt ?? null,
			canManageBilling: ctx.orgRole === 'admin',
			trialAvailable:
				!billing ||
				(billing.billingStatus === null &&
					billing.trialStartedAt === null &&
					billing.trialEndsAt === null &&
					billing.stripeSubscriptionId === null),
			requiresBillingAction: billing?.billingStatus === 'trialing' && billing.hasDefaultPaymentMethod !== true,
		};
	}),

	getStatus: cloudBillingAdminProcedure.query(async ({ ctx }) => {
		const organization = await getCloudBillingOrganizationForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		});
		const trialAvailable =
			organization.billingStatus === null &&
			organization.trialStartedAt === null &&
			organization.trialEndsAt === null &&
			organization.stripeSubscriptionId === null;
		const { availablePlan, subscriptionPlan } = await getCloudBillingPlans(organization.stripePriceId).catch(
			(error: unknown) => throwBillingFailure('plan lookup', 'Unable to load billing plans', error),
		);
		return {
			plan: organization.billingPlan === CLOUD_MONTHLY_PLAN.key ? (subscriptionPlan ?? availablePlan) : null,
			availablePlan,
			planKey: organization.billingPlan,
			status: organization.billingStatus,
			trialStartedAt: organization.trialStartedAt,
			trialEndsAt: organization.trialEndsAt,
			currentPeriodEndsAt: organization.currentPeriodEndsAt,
			cancellationScheduled: organization.cancellationScheduled,
			hasDefaultPaymentMethod: organization.hasDefaultPaymentMethod,
			billingAccessEndsAt: organization.billingAccessEndsAt,
			canManageBilling: true,
			trialAvailable,
			portalAvailable: Boolean(organization.stripeCustomerId && organization.stripeSubscriptionId),
			invoiceHistoryAvailable: Boolean(organization.stripeCustomerId),
			paymentMethodManagementAvailable: Boolean(organization.stripeCustomerId),
			resubscribeAvailable:
				(!organization.stripeSubscriptionId && !trialAvailable) ||
				(Boolean(organization.stripeCustomerId && organization.stripeSubscriptionId) &&
					isTerminalBillingStatus(organization.billingStatus)),
			hasStripeSubscription: Boolean(organization.stripeSubscriptionId),
		};
	}),

	createTrialCheckoutSession: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		try {
			const url = await createCloudTrialCheckoutForAdmin({
				userId: ctx.user.id,
				organizationId: ctx.organization.id,
			});
			return { url };
		} catch (error) {
			if (error instanceof CloudInitialCheckoutUnavailableError) {
				throw new TRPCError({ code: 'CONFLICT', message: error.message });
			}
			throwBillingFailure('trial activation', 'Unable to start the free trial', error);
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
