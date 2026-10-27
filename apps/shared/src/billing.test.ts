import { describe, expect, it } from 'vitest';

import {
	calculateCreditTopUp,
	CREDIT_TOP_UP_MAX_CENTS,
	CREDIT_TOP_UP_MIN_CENTS,
	formatMicroUsd,
	isTerminalBillingStatus,
	isTrialAvailable,
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
