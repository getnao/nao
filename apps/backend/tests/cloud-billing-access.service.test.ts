import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	countOrgSeatUsers: vi.fn(),
	getOrganizationBilling: vi.fn(),
	getOrganizationById: vi.fn(),
	getProjectById: vi.fn(),
	isCloudBillingEnabled: vi.fn(() => true),
	isCloudFreeTierEnabled: vi.fn(() => false),
	listOrgSeatCandidates: vi.fn(),
	listReadOnlyOrgUsers: vi.fn(),
}));

vi.mock('../src/env', () => ({
	isCloudBillingEnabled: mocks.isCloudBillingEnabled,
	isCloudFreeTierEnabled: mocks.isCloudFreeTierEnabled,
}));
vi.mock('../src/queries/billing.queries', () => ({ getOrganizationBilling: mocks.getOrganizationBilling }));
vi.mock('../src/queries/organization.queries', () => ({
	countOrgSeatUsers: mocks.countOrgSeatUsers,
	getOrganizationById: mocks.getOrganizationById,
	listOrgSeatCandidates: mocks.listOrgSeatCandidates,
	listReadOnlyOrgUsers: mocks.listReadOnlyOrgUsers,
}));
vi.mock('../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));

import {
	assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess,
	assertUserCloudBillingAccess,
	getOrganizationCloudEntitlement,
	hasCloudBillingAccess,
	hasProjectCloudBillingAccess,
	hasUserCloudBillingAccess,
	isActiveLocalTrial,
	isActiveTrialWithoutPaidPlan,
	isExpiredTrialWithoutPaidPlan,
	isUserReadOnlyInOrganization,
	resolveCloudEntitlement,
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
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(false);
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
				billingPlan: 'cloud_monthly_v2',
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

	it('does not extend a trial placeholder because its Customer has a payment method', () => {
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

		expect(isExpiredTrialWithoutPaidPlan(withinGrace, now.getTime())).toBe(true);
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

describe('resolved cloud entitlement', () => {
	it.each([
		[
			'local trial',
			entitlement('trialing', { trialEndsAt: future, billingAccessEndsAt: future }),
			0,
			{ tier: 'trial', hasAccess: true, seatLimit: null },
		],
		[
			'paid Team trial',
			entitlement('trialing', {
				billingPlan: 'cloud_team_monthly_v1',
				stripeSubscriptionId: 'sub_team',
				seatQuantity: 4,
				trialEndsAt: future,
				billingAccessEndsAt: future,
			}),
			8,
			{ tier: 'trial', hasAccess: true, seatLimit: null },
		],
		[
			'live Team subscription',
			entitlement('active', {
				billingPlan: 'cloud_team_monthly_v1',
				seatQuantity: 4,
				currentPeriodEndsAt: future,
			}),
			6,
			{ tier: 'team', hasAccess: true, seatLimit: 4, availableSeats: 0, overCapacity: true },
		],
		[
			'Team subscription with unknown quantity',
			entitlement('active', {
				billingPlan: 'cloud_team_yearly_v1',
				currentPeriodEndsAt: future,
			}),
			4,
			{ tier: 'team', hasAccess: true, seatLimit: null, availableSeats: null, overCapacity: false },
		],
		[
			'current Unlimited subscription',
			entitlement('active', {
				billingPlan: 'cloud_unlimited_monthly_v1',
				currentPeriodEndsAt: future,
			}),
			20,
			{ tier: 'unlimited', hasAccess: true, seatLimit: null },
		],
		[
			'legacy Unlimited subscription',
			entitlement('active', { billingPlan: 'cloud_monthly_v2', currentPeriodEndsAt: future }),
			20,
			{ tier: 'unlimited', hasAccess: true, seatLimit: null },
		],
		[
			'missing billing row',
			null,
			2,
			{ tier: 'free', hasAccess: true, seatLimit: 3, availableSeats: 1, overCapacity: false },
		],
		[
			'expired trial',
			entitlement('trialing', { trialEndsAt: past, billingAccessEndsAt: past }),
			5,
			{ tier: 'free', hasAccess: true, seatLimit: 3, availableSeats: 0, overCapacity: true },
		],
		[
			'paused paid subscription',
			entitlement('paused', { billingPlan: 'cloud_team_monthly_v1', seatQuantity: 8 }),
			5,
			{ tier: 'free', hasAccess: true, seatLimit: 3, overCapacity: true },
		],
		[
			'unpaid subscription',
			entitlement('unpaid', { billingPlan: 'cloud_unlimited_monthly_v1' }),
			2,
			{ tier: 'free', hasAccess: true, seatLimit: 3, overCapacity: false },
		],
		[
			'incomplete subscription',
			entitlement('incomplete', { billingPlan: 'cloud_team_monthly_v1', seatQuantity: 4 }),
			2,
			{ tier: 'free', hasAccess: true, seatLimit: 3, overCapacity: false },
		],
	] as const)('%s', (_label, billing, seatUserCount, expected) => {
		expect(
			resolveCloudEntitlement({
				billing,
				bypassBilling: false,
				cloudBillingEnabled: true,
				freeTierEnabled: true,
				seatUserCount,
				now: now.getTime(),
			}),
		).toMatchObject(expected);
	});

	it('gives disabled cloud billing and bypass organizations precedence over billing state', () => {
		const billing = entitlement('canceled');
		expect(
			resolveCloudEntitlement({
				billing,
				bypassBilling: false,
				cloudBillingEnabled: false,
				freeTierEnabled: false,
				seatUserCount: 10,
			}),
		).toMatchObject({ tier: 'bypass', hasAccess: true, seatLimit: null });
		expect(
			resolveCloudEntitlement({
				billing,
				bypassBilling: true,
				cloudBillingEnabled: true,
				freeTierEnabled: true,
				seatUserCount: 10,
			}),
		).toMatchObject({ tier: 'bypass', hasAccess: true, seatLimit: null });
	});

	it('preserves legacy access behavior while the Free tier flag is off', () => {
		const active = resolveCloudEntitlement({
			billing: entitlement('active', {
				billingPlan: 'cloud_monthly_v2',
				currentPeriodEndsAt: future,
			}),
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: false,
			seatUserCount: 0,
			now: now.getTime(),
		});
		const canceled = resolveCloudEntitlement({
			billing: entitlement('canceled'),
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: false,
			seatUserCount: 0,
			now: now.getTime(),
		});

		expect(active.hasAccess).toBe(hasCloudBillingAccess(activeBilling(), now.getTime()));
		expect(canceled.hasAccess).toBe(hasCloudBillingAccess(entitlement('canceled'), now.getTime()));
	});
});

describe('project cloud billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(false);
		mocks.getOrganizationById.mockResolvedValue({ bypassBilling: false });
		mocks.listReadOnlyOrgUsers.mockResolvedValue([]);
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

	it('treats an organization without a billing row as Free when the flag is on', async () => {
		mocks.isCloudFreeTierEnabled.mockReturnValue(true);
		mocks.getProjectById.mockResolvedValue({ orgId: 'organization-1' });
		mocks.getOrganizationBilling.mockResolvedValue(null);
		mocks.countOrgSeatUsers.mockResolvedValue(2);

		await expect(hasProjectCloudBillingAccess('project-1')).resolves.toBe(true);
		await expect(getOrganizationCloudEntitlement('organization-1')).resolves.toMatchObject({
			tier: 'free',
			hasAccess: true,
			seatUserCount: 2,
			availableSeats: 1,
		});
	});
});

describe('user cloud billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(true);
		mocks.listOrgSeatCandidates.mockResolvedValue([]);
		mocks.listReadOnlyOrgUsers.mockResolvedValue([]);
	});

	it('restricts an unseated seat user but not a viewer', async () => {
		const resolved = resolveCloudEntitlement({
			billing: null,
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: true,
			seatUserCount: 5,
		});
		mocks.listReadOnlyOrgUsers.mockResolvedValue([{ id: 'read-only-user' }]);

		await expect(isUserReadOnlyInOrganization('organization-1', 'read-only-user', resolved)).resolves.toBe(true);
		await expect(hasUserCloudBillingAccess('organization-1', 'viewer-user', resolved)).resolves.toBe(true);
		await expect(assertUserCloudBillingAccess('organization-1', 'read-only-user', resolved)).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: expect.stringMatching(/^Cloud billing seat access is restricted\./),
		});
	});

	it('keeps an explicitly unassigned user read-only while capacity is available', async () => {
		const resolved = resolveCloudEntitlement({
			billing: null,
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: true,
			seatUserCount: 2,
		});
		mocks.listReadOnlyOrgUsers.mockResolvedValue([{ id: 'read-only-user' }]);

		await expect(isUserReadOnlyInOrganization('organization-1', 'read-only-user', resolved)).resolves.toBe(true);
	});

	it('honors explicit seat assignments during the trial', async () => {
		const resolved = resolveCloudEntitlement({
			billing: entitlement('trialing', {
				trialEndsAt: future,
				billingAccessEndsAt: future,
			}),
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: true,
			seatUserCount: 2,
			now: now.getTime(),
		});
		mocks.listReadOnlyOrgUsers.mockResolvedValue([{ id: 'read-only-user' }]);

		await expect(isUserReadOnlyInOrganization('organization-1', 'read-only-user', resolved)).resolves.toBe(true);
	});

	it('fails closed for Team seat users when purchased quantity is missing', async () => {
		const resolved = resolveCloudEntitlement({
			billing: entitlement('active', {
				billingPlan: 'cloud_team_monthly_v1',
				currentPeriodEndsAt: future,
			}),
			bypassBilling: false,
			cloudBillingEnabled: true,
			freeTierEnabled: true,
			seatUserCount: 4,
			now: now.getTime(),
		});
		mocks.listOrgSeatCandidates.mockResolvedValue([{ id: 'seat-user' }]);

		await expect(hasUserCloudBillingAccess('organization-1', 'seat-user', resolved)).resolves.toBe(false);
		await expect(hasUserCloudBillingAccess('organization-1', 'viewer-user', resolved)).resolves.toBe(true);
	});

	it('keeps seat assertions as no-ops while the flag is off', async () => {
		mocks.isCloudFreeTierEnabled.mockReturnValue(false);

		await expect(assertUserCloudBillingAccess('organization-1', 'seat-user')).resolves.toBeUndefined();
		expect(mocks.getOrganizationById).not.toHaveBeenCalled();
		expect(mocks.listReadOnlyOrgUsers).not.toHaveBeenCalled();
	});
});

describe('cloud billing access assertions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(false);
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
		seatQuantity: number | null;
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

function activeBilling() {
	return entitlement('active', {
		billingPlan: 'cloud_monthly_v2',
		currentPeriodEndsAt: future,
	});
}
