import { describe, expect, it } from 'vitest';

import { isTerminalBillingStatus, isTrialAvailable } from './billing';

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
		expect(
			isTrialAvailable({
				billingStatus: null,
				trialStartedAt: new Date(),
				trialEndsAt: null,
				stripeSubscriptionId: null,
			}),
		).toBe(false);
	});
});
