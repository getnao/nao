import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TwoFactorGracePeriod } from '../src/types/two-factor';

const state = vi.hoisted(() => ({
	gracePeriods: [] as TwoFactorGracePeriod[],
	enabled: false,
	password: 'hash' as string | null,
	policies: [['totp', 'email']] as string[][],
}));

vi.mock('../src/queries/two-factor.queries', () => ({
	listUserTwoFactorGracePeriods: vi.fn(async () => state.gracePeriods),
	getTwoFactorEnrollment: vi.fn(async () => ({ enabled: state.enabled, totpVerified: state.enabled ? true : null })),
	listUserOrganizationsTwoFactorMethods: vi.fn(async () => state.policies),
}));
vi.mock('../src/queries/account.queries', () => ({
	getAccountById: vi.fn(async () => (state.password ? { id: 'account-1', password: state.password } : null)),
}));
vi.mock('../src/services/email', () => ({ emailService: { isEnabled: () => true } }));

import { getTwoFactorStatus, isTwoFactorSetupOverdue } from '../src/services/two-factor.service';
import { computeGracePeriodDeadline, getTwoFactorDeadline } from '../src/services/two-factor-requirement.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('two-factor authentication requirement', () => {
	beforeEach(() => {
		state.gracePeriods = [];
		state.enabled = false;
		state.password = 'hash';
		state.policies = [['totp', 'email']];
	});

	it('counts the grace period from the latest of the requirement, the membership and a restart', () => {
		const deadline = computeGracePeriodDeadline({
			requiredAt: new Date('2026-01-01T00:00:00Z'),
			memberSince: new Date('2026-01-05T00:00:00Z'),
			graceRestartedAt: new Date('2026-01-03T00:00:00Z'),
			gracePeriodDays: 7,
		});

		expect(deadline).toEqual(new Date('2026-01-12T00:00:00Z'));
	});

	it('uses the earliest deadline across the organizations of the user', async () => {
		state.gracePeriods = [
			gracePeriod({ daysAgo: 1, gracePeriodDays: 30 }),
			gracePeriod({ daysAgo: 1, gracePeriodDays: 3 }),
		];

		const deadline = await getTwoFactorDeadline('user-1');

		expect(deadline).toEqual(new Date(state.gracePeriods[1].requiredAt.getTime() + 3 * DAY_MS));
	});

	it('reports the deadline during the grace period without blocking the user', async () => {
		state.gracePeriods = [gracePeriod({ daysAgo: 1, gracePeriodDays: 7 })];

		const status = await getTwoFactorStatus('user-1');

		expect(status.requirement?.isOverdue).toBe(false);
		expect(await isTwoFactorSetupOverdue('user-1')).toBe(false);
	});

	it('blocks the user once the grace period is over', async () => {
		state.gracePeriods = [gracePeriod({ daysAgo: 10, gracePeriodDays: 7 })];

		expect((await getTwoFactorStatus('user-1')).requirement?.isOverdue).toBe(true);
		expect(await isTwoFactorSetupOverdue('user-1')).toBe(true);
	});

	it.each([
		['has set up two-factor authentication', { enabled: true }],
		['only signs in through SSO', { password: null }],
		['cannot set up any allowed method', { policies: [['totp'], ['email']] }],
	])('never blocks a user who %s', async (_case, overrides) => {
		state.gracePeriods = [gracePeriod({ daysAgo: 10, gracePeriodDays: 7 })];
		Object.assign(state, overrides);

		expect(await isTwoFactorSetupOverdue('user-1')).toBe(false);
		expect((await getTwoFactorStatus('user-1')).requirement).toBeNull();
	});

	it('does not require anything when no organization requires it', async () => {
		expect(await getTwoFactorDeadline('user-1')).toBeNull();
		expect(await isTwoFactorSetupOverdue('user-1')).toBe(false);
	});
});

function gracePeriod({ daysAgo, gracePeriodDays }: { daysAgo: number; gracePeriodDays: number }): TwoFactorGracePeriod {
	return {
		requiredAt: new Date(Date.now() - daysAgo * DAY_MS),
		memberSince: new Date('2020-01-01T00:00:00Z'),
		graceRestartedAt: null,
		gracePeriodDays,
	};
}
