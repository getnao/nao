import { describe, expect, it } from 'vitest';

import {
	getCloudBillingAccessRefetchInterval,
	isCloudBillingAccessError,
	isCloudBillingSeatError,
} from '@/lib/cloud-billing-access';

const activeAccess = {
	status: 'active',
	hasAccess: true,
	accessEndsAt: null,
	bypassBilling: false,
	canManageBilling: false,
	isReadOnly: false,
	seatLimit: null,
	seatUserCount: 2,
};

describe('cloud billing access UI', () => {
	it('recognizes restricted-access and seat errors', () => {
		expect(isCloudBillingAccessError({ message: 'Cloud billing access is restricted. Ask an admin.' })).toBe(true);
		expect(isCloudBillingAccessError({ message: 'Provider failed' })).toBe(false);
		expect(isCloudBillingSeatError({ error: 'Cloud billing seat access is restricted. Ask an admin.' })).toBe(true);
		expect(isCloudBillingSeatError({ message: 'Cloud billing access is restricted.' })).toBe(false);
	});

	it('refetches active access when its entitlement expires', () => {
		const now = new Date('2026-10-07T12:00:00.000Z');
		const accessEndsAt = new Date(now.getTime() + 30_000);

		expect(getCloudBillingAccessRefetchInterval({ ...activeAccess, accessEndsAt }, now.getTime())).toBe(30_000);
		expect(getCloudBillingAccessRefetchInterval(activeAccess, now.getTime())).toBe(false);
		expect(
			getCloudBillingAccessRefetchInterval({ ...activeAccess, status: 'trialing', accessEndsAt }, now.getTime()),
		).toBe(60_000);
	});

	it.each([
		['the user is read-only', { isReadOnly: true }],
		['more people need seats than the plan has', { seatLimit: 3, seatUserCount: 4 }],
	])('keeps polling active access while %s', (_case, seatState) => {
		expect(getCloudBillingAccessRefetchInterval({ ...activeAccess, ...seatState })).toBe(60_000);
	});

	it('stops polling bypassed billing for members but not admins', () => {
		const access = { ...activeAccess, status: null, hasAccess: false, bypassBilling: true };

		expect(getCloudBillingAccessRefetchInterval({ ...access, canManageBilling: false })).toBe(false);
		expect(getCloudBillingAccessRefetchInterval({ ...access, canManageBilling: true })).toBe(60_000);
	});
});
