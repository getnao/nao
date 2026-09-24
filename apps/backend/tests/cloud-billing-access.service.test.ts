import { describe, expect, it, vi } from 'vitest';

import { hasCloudBillingAccess } from '../src/services/cloud-billing-access.service';
import type { BillingStatus } from '../src/types/billing';

vi.mock('../src/queries/organization.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({}));

const now = new Date('2026-09-24T12:00:00.000Z');
const future = new Date('2026-09-25T12:00:00.000Z');
const past = new Date('2026-09-23T12:00:00.000Z');
const recentlyPast = new Date('2026-09-24T00:00:00.000Z');

describe('cloud billing access entitlement', () => {
	it.each([
		['billing disabled', false, null, true],
		['local trial before its end', true, entitlement('trialing', { trialEndsAt: future }), true],
		[
			'trialing before its billing access end',
			true,
			entitlement('trialing', { trialEndsAt: future, billingAccessEndsAt: future }),
			true,
		],
		['expired trial', true, entitlement('trialing', { trialEndsAt: past }), false],
		[
			'trial past its access end',
			true,
			entitlement('trialing', { trialEndsAt: future, billingAccessEndsAt: past }),
			false,
		],
		['trial missing its end', true, entitlement('trialing'), false],
		[
			'renewing active within reconciliation grace',
			true,
			entitlement('active', { currentPeriodEndsAt: recentlyPast }),
			true,
		],
		[
			'renewing active past reconciliation grace',
			true,
			entitlement('active', { currentPeriodEndsAt: past }),
			false,
		],
		['active missing its period end', true, entitlement('active'), false],
		[
			'scheduled cancellation before access end',
			true,
			entitlement('active', { cancelAtPeriodEnd: true, billingAccessEndsAt: future }),
			true,
		],
		[
			'scheduled cancellation past access end',
			true,
			entitlement('active', { cancelAtPeriodEnd: true, billingAccessEndsAt: past }),
			false,
		],
		['past due while Stripe retries', true, entitlement('past_due'), true],
		['unpaid', true, entitlement('unpaid'), false],
		['paused', true, entitlement('paused'), false],
		['incomplete', true, entitlement('incomplete'), false],
		['incomplete expired', true, entitlement('incomplete_expired'), false],
		['canceled', true, entitlement('canceled'), false],
		['missing billing state', true, null, false],
	] as const)('%s', (_label, billingEnabled, state, expected) => {
		expect(hasCloudBillingAccess(billingEnabled, state, now)).toBe(expected);
	});
});

function entitlement(
	billingStatus: BillingStatus,
	overrides: Partial<{
		trialEndsAt: Date;
		currentPeriodEndsAt: Date;
		billingAccessEndsAt: Date;
		cancelAtPeriodEnd: boolean;
	}> = {},
) {
	return {
		billingStatus,
		trialEndsAt: null,
		currentPeriodEndsAt: null,
		billingAccessEndsAt: null,
		...overrides,
	};
}
