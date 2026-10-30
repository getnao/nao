import { describe, expect, it } from 'vitest';

import {
	calculateCreditTopUp,
	CLOUD_BILLING_PLANS,
	CLOUD_BILLING_TIER_ORDER,
	CREDIT_TOP_UP_MAX_CENTS,
	CREDIT_TOP_UP_MIN_CENTS,
	formatMicroUsd,
	FREE_TIER_SEAT_LIMIT,
	getCloudBillingPlanDefinition,
	isCloudBillingPlanKey,
	isLegacyCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	LEGACY_CLOUD_BILLING_PLANS,
	TEAM_MAX_SEATS,
	TEAM_MIN_SEATS,
} from './billing';

describe('micro USD formatting', () => {
	it.each([
		[1_234_567, {}, '$1.23'],
		[20_000_000, { minimumFractionDigits: 0, maximumFractionDigits: 2 }, '$20'],
		[20_500_000, { minimumFractionDigits: 0, maximumFractionDigits: 2 }, '$20.5'],
		[1_234_567, { style: 'percent' as const, currency: 'EUR' }, '$1.23'],
	])('formats %i micro USD', (microUsd, options, expected) => {
		expect(formatMicroUsd(microUsd, { locale: 'en-US', ...options })).toBe(expected);
	});
});

describe('credit top-up pricing', () => {
	it.each([
		[2_000, 100, 2_100, 20_000_000],
		[2_001, 101, 2_102, 20_010_000],
		[50_000, 2_500, 52_500, 500_000_000],
	])(
		'calculates a separately rounded 5%% platform fee for %i cents',
		(creditAmountCents, platformFeeCents, totalAmountCents, walletAmountMicroUsd) => {
			expect(calculateCreditTopUp(creditAmountCents)).toEqual({
				creditAmountCents,
				platformFeeCents,
				totalAmountCents,
				walletAmountMicroUsd,
			});
		},
	);

	it.each([CREDIT_TOP_UP_MIN_CENTS - 1, CREDIT_TOP_UP_MAX_CENTS + 1, 2_000.5])(
		'rejects invalid amount %s',
		(amount) => {
			expect(() => calculateCreditTopUp(amount)).toThrow(RangeError);
		},
	);
});

describe('billing state', () => {
	it.each([
		['canceled', true],
		['incomplete_expired', true],
		['active', false],
		[null, false],
	] as const)('identifies terminal status %s', (status, expected) => {
		expect(isTerminalBillingStatus(status)).toBe(expected);
	});

	it('only offers a trial before billing history exists', () => {
		expect(isTrialAvailable(null)).toBe(true);
		expect(
			isTrialAvailable({
				billingStatus: null,
				trialStartedAt: null,
				trialEndsAt: null,
				stripeSubscriptionId: null,
			}),
		).toBe(true);
	});

	it.each([
		[
			'billing status',
			{ billingStatus: 'canceled', trialStartedAt: null, trialEndsAt: null, stripeSubscriptionId: null },
		],
		[
			'trial start',
			{ billingStatus: null, trialStartedAt: new Date(), trialEndsAt: null, stripeSubscriptionId: null },
		],
		[
			'trial end',
			{ billingStatus: null, trialStartedAt: null, trialEndsAt: new Date(), stripeSubscriptionId: null },
		],
		[
			'Stripe subscription',
			{ billingStatus: null, trialStartedAt: null, trialEndsAt: null, stripeSubscriptionId: 'sub_123' },
		],
	] as const)('does not offer a trial when %s history exists', (_label, billing) => {
		expect(isTrialAvailable(billing)).toBe(false);
	});
});

describe('cloud billing catalogue', () => {
	it('defines every current tier and interval combination', () => {
		expect(Object.keys(CLOUD_BILLING_PLANS)).toEqual([
			'cloud_team_monthly_v1',
			'cloud_team_yearly_v1',
			'cloud_unlimited_monthly_v1',
			'cloud_unlimited_yearly_v1',
		]);
		expect(getCloudBillingPlanDefinition('team', 'monthly')).toMatchObject({
			key: 'cloud_team_monthly_v1',
			tier: 'team',
			interval: 'month',
			perSeat: true,
		});
		expect(getCloudBillingPlanDefinition('team', 'yearly')).toMatchObject({
			key: 'cloud_team_yearly_v1',
			interval: 'year',
			perSeat: true,
		});
		expect(getCloudBillingPlanDefinition('unlimited', 'monthly')).toMatchObject({
			key: 'cloud_unlimited_monthly_v1',
			tier: 'unlimited',
			interval: 'month',
			perSeat: false,
		});
		expect(getCloudBillingPlanDefinition('unlimited', 'yearly')).toMatchObject({
			key: 'cloud_unlimited_yearly_v1',
			interval: 'year',
			perSeat: false,
		});
	});

	it('keeps grandfathered plans separate from sellable plans', () => {
		expect(Object.keys(LEGACY_CLOUD_BILLING_PLANS)).toEqual(['cloud_monthly_v2', 'cloud_yearly_v1']);
		expect(LEGACY_CLOUD_BILLING_PLANS.cloud_monthly_v2).toMatchObject({
			tier: 'unlimited',
			interval: 'month',
			legacy: true,
		});
		expect(LEGACY_CLOUD_BILLING_PLANS.cloud_yearly_v1).toMatchObject({
			tier: 'unlimited',
			interval: 'year',
			legacy: true,
		});
	});

	it('validates current and legacy plan keys without accepting arbitrary strings', () => {
		expect(isCloudBillingPlanKey('cloud_team_monthly_v1')).toBe(true);
		expect(isCloudBillingPlanKey('cloud_unlimited_yearly_v1')).toBe(true);
		expect(isCloudBillingPlanKey('cloud_monthly_v2')).toBe(false);
		expect(isCloudBillingPlanKey('monthly')).toBe(false);
		expect(isLegacyCloudBillingPlanKey('cloud_monthly_v2')).toBe(true);
		expect(isLegacyCloudBillingPlanKey('cloud_yearly_v1')).toBe(true);
		expect(isLegacyCloudBillingPlanKey('cloud_team_monthly_v1')).toBe(false);
	});

	it('defines capacity constants and tier ordering', () => {
		expect(FREE_TIER_SEAT_LIMIT).toBe(3);
		expect(TEAM_MIN_SEATS).toBe(4);
		expect(TEAM_MAX_SEATS).toBe(40);
		expect(CLOUD_BILLING_TIER_ORDER).toEqual(['free', 'team', 'unlimited']);
	});
});
