import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOrganizationBilling: vi.fn(),
	getOrganizationById: vi.fn(),
	getProjectById: vi.fn(),
	isCloudBillingEnabled: vi.fn(() => true),
}));

vi.mock('../src/env', () => ({ isCloudBillingEnabled: mocks.isCloudBillingEnabled }));
vi.mock('../src/queries/billing.queries', () => ({ getOrganizationBilling: mocks.getOrganizationBilling }));
vi.mock('../src/queries/organization.queries', () => ({ getOrganizationById: mocks.getOrganizationById }));
vi.mock('../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));

import {
	assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess,
	hasCloudBillingAccess,
	hasProjectCloudBillingAccess,
	isActiveLocalTrial,
	isActiveTrialWithoutPaidPlan,
	isExpiredTrialWithoutPaidPlan,
} from '../src/services/cloud-billing-access.service';
import type { BillingStatus } from '../src/types/billing';

const now = new Date('2026-09-24T12:00:00.000Z');
const future = new Date('2026-09-25T12:00:00.000Z');
const past = new Date('2026-09-23T12:00:00.000Z');
const recentlyPast = new Date('2026-09-24T00:00:00.000Z');

describe('cloud billing access entitlement', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		['unconfirmed local trial', entitlement('trialing', { trialEndsAt: future }), false],
		['confirmed local trial', entitlement('trialing', { trialEndsAt: future, billingAccessEndsAt: future }), true],
		[
			'trialing before its billing access end',
			entitlement('trialing', {
				stripeSubscriptionId: 'sub_trial',
				trialEndsAt: future,
				billingAccessEndsAt: future,
			}),
			true,
		],
		['expired trial', entitlement('trialing', { stripeSubscriptionId: 'sub_trial', trialEndsAt: past }), false],
		[
			'trial past its access end',
			entitlement('trialing', {
				stripeSubscriptionId: 'sub_trial',
				trialEndsAt: future,
				billingAccessEndsAt: past,
			}),
			false,
		],
		['trial missing its end', entitlement('trialing', { stripeSubscriptionId: 'sub_trial' }), false],
		[
			'paying trial within conversion grace',
			entitlement('trialing', {
				stripeSubscriptionId: 'sub_trial',
				trialEndsAt: recentlyPast,
				billingAccessEndsAt: recentlyPast,
				hasDefaultPaymentMethod: true,
			}),
			true,
		],
		[
			'canceling paying trial past its end',
			entitlement('trialing', {
				stripeSubscriptionId: 'sub_trial',
				trialEndsAt: recentlyPast,
				billingAccessEndsAt: recentlyPast,
				hasDefaultPaymentMethod: true,
				cancellationScheduled: true,
			}),
			false,
		],
		[
			'active before its period end',
			entitlement('active', { billingPlan: 'cloud_monthly_v2', currentPeriodEndsAt: future }),
			true,
		],
		[
			'renewing active within reconciliation grace',
			entitlement('active', { billingPlan: 'cloud_monthly_v2', currentPeriodEndsAt: recentlyPast }),
			true,
		],
		[
			'renewing active past reconciliation grace',
			entitlement('active', { billingPlan: 'cloud_monthly_v2', currentPeriodEndsAt: past }),
			false,
		],
		['active missing its period end', entitlement('active', { billingPlan: 'cloud_monthly_v2' }), false],
		['active trial placeholder', entitlement('active', { currentPeriodEndsAt: future }), false],
		[
			'scheduled cancellation before access end',
			entitlement('active', {
				billingPlan: 'cloud_monthly_v2',
				cancellationScheduled: true,
				billingAccessEndsAt: future,
			}),
			true,
		],
		[
			'scheduled cancellation past access end',
			entitlement('active', {
				billingPlan: 'cloud_monthly_v2',
				cancellationScheduled: true,
				billingAccessEndsAt: past,
			}),
			false,
		],
		[
			'past due within its bounded payment grace',
			entitlement('past_due', {
				billingPlan: 'cloud_monthly_v2',
				currentPeriodStartsAt: past,
				currentPeriodEndsAt: recentlyPast,
			}),
			true,
		],
		[
			'past due beyond its bounded payment grace',
			entitlement('past_due', {
				billingPlan: 'cloud_monthly_v2',
				currentPeriodStartsAt: recentlyPast,
				currentPeriodEndsAt: past,
			}),
			false,
		],
		[
			'past due without a period end',
			entitlement('past_due', { billingPlan: 'cloud_monthly_v2', currentPeriodStartsAt: recentlyPast }),
			false,
		],
		['unpaid', entitlement('unpaid'), false],
		['paused', entitlement('paused'), false],
		['incomplete', entitlement('incomplete'), false],
		['incomplete expired', entitlement('incomplete_expired'), false],
		['canceled', entitlement('canceled'), false],
		['missing billing state', null, false],
	] as const)('%s', (_label, state, expected) => {
		expect(hasCloudBillingAccess(state)).toBe(expected);
	});

	it('does not activate an unconfirmed local trial', () => {
		const unconfirmedTrial = entitlement('trialing', { trialEndsAt: future });

		expect(hasCloudBillingAccess(unconfirmedTrial)).toBe(false);
		expect(isActiveLocalTrial(unconfirmedTrial, now.getTime())).toBe(false);
		expect(isActiveTrialWithoutPaidPlan(unconfirmedTrial, now.getTime())).toBe(false);
	});

	it('matches paying trial expiration to the conversion-grace access window', () => {
		const withinGrace = entitlement('trialing', {
			stripeSubscriptionId: 'sub_trial',
			trialEndsAt: recentlyPast,
			billingAccessEndsAt: recentlyPast,
			hasDefaultPaymentMethod: true,
		});
		const afterGrace = entitlement('trialing', {
			stripeSubscriptionId: 'sub_trial',
			trialEndsAt: past,
			billingAccessEndsAt: past,
			hasDefaultPaymentMethod: true,
		});

		expect(isExpiredTrialWithoutPaidPlan(withinGrace, now.getTime())).toBe(false);
		expect(isExpiredTrialWithoutPaidPlan(afterGrace, now.getTime())).toBe(true);
	});

	it.each([
		['expired local trial', entitlement('trialing', { trialEndsAt: past, billingAccessEndsAt: past }), true],
		[
			'trial with a paid plan',
			entitlement('trialing', {
				billingPlan: 'cloud_monthly_v2',
				stripeSubscriptionId: 'sub_trial',
				trialEndsAt: past,
				billingAccessEndsAt: past,
			}),
			false,
		],
	] as const)('%s expiration without a paid plan is %s', (_label, state, expected) => {
		expect(isExpiredTrialWithoutPaidPlan(state, now.getTime())).toBe(expected);
	});
});

describe('project cloud billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: false });
	});

	it('grants access without looking up the project when cloud billing is disabled', async () => {
		mocks.isCloudBillingEnabled.mockReturnValue(false);

		await expect(hasProjectCloudBillingAccess('missing-project')).resolves.toBe(true);
		expect(mocks.getProjectById).not.toHaveBeenCalled();
	});

	it('denies access when the project does not exist', async () => {
		mocks.getProjectById.mockResolvedValue(null);

		await expect(hasProjectCloudBillingAccess('missing-project')).resolves.toBe(false);
		expect(mocks.getOrganizationBilling).not.toHaveBeenCalled();
	});

	it('denies access for a legacy cloud project without an organization', async () => {
		mocks.getProjectById.mockResolvedValue({ orgId: null });

		await expect(hasProjectCloudBillingAccess('orphaned-project')).resolves.toBe(false);
		expect(mocks.getOrganizationBilling).not.toHaveBeenCalled();
	});

	it('delegates organization billing access for an assigned project', async () => {
		mocks.getProjectById.mockResolvedValue({ orgId: 'organization-1' });
		mocks.getOrganizationBilling.mockResolvedValue(
			entitlement('active', {
				billingPlan: 'cloud_monthly_v2',
				currentPeriodEndsAt: new Date('2999-01-01T00:00:00.000Z'),
			}),
		);

		await expect(hasProjectCloudBillingAccess('project-1')).resolves.toBe(true);
		expect(mocks.getOrganizationBilling).toHaveBeenCalledWith('organization-1');
	});

	it('grants access without checking Stripe when the organization bypasses billing', async () => {
		mocks.getProjectById.mockResolvedValue({ orgId: 'organization-1' });
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: true });
		mocks.getOrganizationBilling.mockResolvedValue(null);

		await expect(hasProjectCloudBillingAccess('project-1')).resolves.toBe(true);
		expect(mocks.getOrganizationBilling).not.toHaveBeenCalled();
	});
});

describe('cloud billing access assertions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: true });
		mocks.getOrganizationBilling.mockResolvedValue(null);
	});

	it('allows an organization that bypasses billing', async () => {
		await expect(assertOrganizationCloudBillingAccess('organization-1')).resolves.toBeUndefined();
		expect(mocks.getOrganizationBilling).not.toHaveBeenCalled();
	});

	it('allows a project whose organization bypasses billing', async () => {
		mocks.getProjectById.mockResolvedValue({ orgId: 'organization-1' });

		await expect(assertProjectCloudBillingAccess('project-1')).resolves.toBeUndefined();
		expect(mocks.getOrganizationBilling).not.toHaveBeenCalled();
	});

	it('rejects an organization without billing access', async () => {
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: false });

		await expect(assertOrganizationCloudBillingAccess('organization-1')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: 'Cloud billing access is restricted. Ask an organization admin to update billing.',
		});
	});

	it('rejects a project without billing access', async () => {
		mocks.getProjectById.mockResolvedValue({ orgId: 'organization-1' });
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: false });

		await expect(assertProjectCloudBillingAccess('project-1')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: 'Cloud billing access is restricted. Ask an organization admin to update billing.',
		});
	});
});

function entitlement(
	billingStatus: BillingStatus,
	overrides: Partial<{
		billingPlan: string | null;
		stripeSubscriptionId: string;
		trialEndsAt: Date;
		currentPeriodStartsAt: Date;
		currentPeriodEndsAt: Date;
		billingAccessEndsAt: Date;
		cancellationScheduled: boolean;
		hasDefaultPaymentMethod: boolean;
	}> = {},
) {
	return {
		billingPlan: null,
		billingStatus,
		stripeSubscriptionId: null,
		trialEndsAt: null,
		currentPeriodStartsAt: null,
		currentPeriodEndsAt: null,
		billingAccessEndsAt: null,
		...overrides,
	};
}
