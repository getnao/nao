import { describe, expect, it } from 'vitest';

import { getCloudBillingAccessRefetchInterval, isCloudBillingAccessError } from './cloud-billing-access';

describe('cloud billing access UI', () => {
	it('recognizes restricted-access errors', () => {
		expect(isCloudBillingAccessError({ message: 'Cloud billing access is restricted. Ask an admin.' })).toBe(true);
		expect(isCloudBillingAccessError({ message: 'Provider failed' })).toBe(false);
	});

	it('stops polling after active access is confirmed', () => {
		expect(getCloudBillingAccessRefetchInterval({ status: 'active', hasAccess: true })).toBe(false);
		expect(getCloudBillingAccessRefetchInterval({ status: 'trialing', hasAccess: true })).toBe(60_000);
	});
});
