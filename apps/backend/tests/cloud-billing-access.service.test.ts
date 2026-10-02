import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasCloudBillingAccess } from '../src/services/cloud-billing-access.service';
import type { BillingStatus } from '../src/types/billing';

vi.mock('../src/queries/organization.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({}));

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
		['trial missing its end', entitlement('trialing'), false],
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
		['active before its period end', entitlement('active', { currentPeriodEndsAt: future }), true],
		[
			'renewing active within reconciliation grace',
			entitlement('active', { currentPeriodEndsAt: recentlyPast }),
			true,
		],
		['renewing active past reconciliation grace', entitlement('active', { currentPeriodEndsAt: past }), false],
		['active missing its period end', entitlement('active'), false],
		[
			'scheduled cancellation before access end',
			entitlement('active', { cancellationScheduled: true, billingAccessEndsAt: future }),
			true,
		],
		[
			'scheduled cancellation past access end',
			entitlement('active', { cancellationScheduled: true, billingAccessEndsAt: past }),
			false,
		],
		['past due while Stripe retries', entitlement('past_due', { currentPeriodEndsAt: future }), true],
		['past due beyond its period end', entitlement('past_due', { currentPeriodEndsAt: past }), false],
		['unpaid', entitlement('unpaid'), false],
		['paused', entitlement('paused'), false],
		['incomplete', entitlement('incomplete'), false],
		['incomplete expired', entitlement('incomplete_expired'), false],
		['canceled', entitlement('canceled'), false],
		['missing billing state', null, false],
	] as const)('%s', (_label, state, expected) => {
		expect(hasCloudBillingAccess(state)).toBe(expected);
	});
});

function entitlement(
	billingStatus: BillingStatus,
	overrides: Partial<{
		stripeSubscriptionId: string;
		trialEndsAt: Date;
		currentPeriodEndsAt: Date;
		billingAccessEndsAt: Date;
		cancellationScheduled: boolean;
		hasDefaultPaymentMethod: boolean;
	}> = {},
) {
	return {
		billingStatus,
		stripeSubscriptionId: null,
		trialEndsAt: null,
		currentPeriodEndsAt: null,
		billingAccessEndsAt: null,
		...overrides,
	};
}
