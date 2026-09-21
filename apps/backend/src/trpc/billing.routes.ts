import { TRPCError } from '@trpc/server';

import * as orgQueries from '../queries/organization.queries';
import { isCloudBillingEnabled } from '../services/stripe.service';
import { CLOUD_MONTHLY_PLAN } from '../types/billing';
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

export const billingRoutes = {
	getStatus: cloudBillingMemberProcedure.query(({ ctx }) => ({
		plan: ctx.organization.billingPlan === CLOUD_MONTHLY_PLAN.key ? CLOUD_MONTHLY_PLAN : null,
		planKey: ctx.organization.billingPlan,
		status: ctx.organization.billingStatus,
		trialStartedAt: ctx.organization.trialStartedAt,
		trialEndsAt: ctx.organization.trialEndsAt,
		currentPeriodEndsAt: ctx.organization.currentPeriodEndsAt,
		cancelAtPeriodEnd: ctx.organization.cancelAtPeriodEnd,
		billingAccessEndsAt: ctx.organization.billingAccessEndsAt,
		canManageBilling: ctx.orgRole === 'admin',
	})),
};
