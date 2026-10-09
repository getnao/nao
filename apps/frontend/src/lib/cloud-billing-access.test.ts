import { describe, expect, it } from 'vitest';

import { getCloudBillingAccessRefetchInterval, isCloudBillingAccessError } from './cloud-billing-access';

describe('cloud billing access UI', () => {
	it('recognizes restricted-access errors', () => {
		expect(isCloudBillingAccessError({ message: 'Cloud billing access is restricted. Ask an admin.' })).toBe(true);
		expect(isCloudBillingAccessError({ message: 'Provider failed' })).toBe(false);
	});

	it('refetches active access when its entitlement expires', () => {
		const now = new Date('2026-10-07T12:00:00.000Z');
		const accessEndsAt = new Date(now.getTime() + 30_000);

		expect(
			getCloudBillingAccessRefetchInterval(
				{ status: 'active', hasAccess: true, accessEndsAt, bypassBilling: false, canManageBilling: false },
				now.getTime(),
			),
		).toBe(30_000);
		expect(
			getCloudBillingAccessRefetchInterval(
				{
					status: 'active',
					hasAccess: true,
					accessEndsAt: null,
					bypassBilling: false,
					canManageBilling: false,
				},
				now.getTime(),
			),
		).toBe(false);
		expect(
			getCloudBillingAccessRefetchInterval(
				{ status: 'trialing', hasAccess: true, accessEndsAt, bypassBilling: false, canManageBilling: false },
				now.getTime(),
			),
		).toBe(60_000);
	});

	it('stops polling bypassed billing for members but not admins', () => {
		const access = {
			status: null,
			hasAccess: false,
			accessEndsAt: null,
			bypassBilling: true,
		};

		expect(getCloudBillingAccessRefetchInterval({ ...access, canManageBilling: false })).toBe(false);
		expect(getCloudBillingAccessRefetchInterval({ ...access, canManageBilling: true })).toBe(60_000);
	});
});
