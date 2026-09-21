import { describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	membership: null as Record<string, unknown> | null,
}));

vi.mock('../src/auth', () => ({
	getSession: vi.fn(async () => null),
}));

vi.mock('../src/queries/project.queries', () => ({}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: vi.fn(async () => testState.membership),
}));

vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

vi.mock('../src/services/stripe.service', () => ({
	isCloudBillingEnabled: vi.fn(() => true),
}));

import { billingRoutes } from '../src/trpc/billing.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ billing: billingRoutes });

describe('billing.getStatus', () => {
	it('returns the organization billing projection and matching plan', async () => {
		const trialEndsAt = new Date('2026-10-05T00:00:00.000Z');
		testState.membership = membership({
			billingPlan: 'cloud_monthly_v1',
			billingStatus: 'trialing',
			trialEndsAt,
		});
		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: {
				key: 'cloud_monthly_v1',
				name: 'nao Cloud',
				amount: 200_000,
				currency: 'eur',
			},
			planKey: 'cloud_monthly_v1',
			status: 'trialing',
			trialEndsAt,
			canManageBilling: true,
		});
	});

	it('does not invent a plan for an uninitialized organization', async () => {
		testState.membership = membership({});

		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: null,
			planKey: null,
			status: null,
		});
	});
});

function caller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id' }, session: { token: 'session-token' } },
		selectedProjectId: null,
	} as never);
}

function membership(organization: Record<string, unknown>) {
	return {
		orgId: 'org-id',
		userId: 'user-id',
		role: 'admin',
		createdAt: new Date(),
		organization: {
			billingPlan: null,
			billingStatus: null,
			trialStartedAt: null,
			trialEndsAt: null,
			currentPeriodEndsAt: null,
			cancelAtPeriodEnd: null,
			billingAccessEndsAt: null,
			...organization,
		},
	};
}
