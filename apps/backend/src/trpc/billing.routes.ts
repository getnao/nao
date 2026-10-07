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
import { getCloudBillingAccessEndsAt, hasCloudBillingAccess } from '../services/cloud-billing-access.service';
import {
	CloudInitialCheckoutUnavailableError,
	CloudSubscriptionResumeError,
	CloudSubscriptionUnavailableError,
	getCloudBillingPlans,
	getCloudSubscription,
} from '../services/stripe.service';
import { CLOUD_BILLING_CURRENCIES, isTerminalBillingStatus, isTrialAvailable } from '../types/billing';
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
const billingStatusInput = z.object({ currency: currencyInput }).optional();
const checkoutInput = z.object({
	billingInterval: z.enum(['monthly', 'yearly']),
	currency: currencyInput.default('usd'),
});

export const billingRoutes = {
	getAccess: cloudBillingAccessProcedure.query(async ({ ctx }) => {
		const billing = await getOrganizationBilling(ctx.organization.id);
		return {
			organizationId: ctx.organization.id,
			hasAccess: hasCloudBillingAccess(billing),
			bypassBilling: ctx.organization.bypassBilling,
			status: billing?.billingStatus ?? null,
			trialEndsAt: billing?.trialEndsAt ?? null,
			accessEndsAt: getCloudBillingAccessEndsAt(billing),
			canManageBilling: ctx.orgRole === 'admin',
			trialAvailable: isTrialAvailable(billing),
			requiresBillingAction: billing?.billingStatus === 'trialing' && billing.hasDefaultPaymentMethod !== true,
		};
	}),

	getStatus: cloudBillingAdminProcedure.input(billingStatusInput).query(async ({ ctx, input }) => {
		const organization = await getCloudBillingOrganizationForAdmin({
			userId: ctx.user.id,
			organizationId: ctx.organization.id,
		});
		const billing = organization.billing;
		const trialAvailable = isTrialAvailable(billing);
		const { availablePlans, subscriptionPlan } = await (async () => {
			const subscriptionCurrency = billing?.stripeSubscriptionId
				? (await getCloudSubscription(billing.stripeSubscriptionId)).currency
				: null;
			return getCloudBillingPlans(billing?.stripePriceId ?? null, input?.currency ?? 'usd', subscriptionCurrency);
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
			portalAvailable: Boolean(billing?.stripeCustomerId && billing.stripeSubscriptionId),
			invoiceHistoryAvailable: Boolean(billing?.stripeCustomerId),
			paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId),
			resubscribeAvailable:
				(!billing?.stripeSubscriptionId && !trialAvailable) ||
				(Boolean(billing?.stripeCustomerId && billing.stripeSubscriptionId) &&
					isTerminalBillingStatus(billing?.billingStatus)),
			hasStripeSubscription: Boolean(billing?.stripeSubscriptionId),
		};
	}),

	createTrialCheckoutSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudTrialCheckoutForAdmin({
				billingInterval: input.billingInterval,
				currency: input.currency,
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

	createResubscribeSession: cloudBillingAdminProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
		try {
			const url = await createCloudResubscribeForAdmin({
				billingInterval: input.billingInterval,
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
