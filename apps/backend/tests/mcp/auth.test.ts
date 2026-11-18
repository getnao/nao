import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	isUserDeactivated: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getSession: mocks.getSession, verifyOAuthAccessToken: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/user.queries', () => ({ isUserDeactivated: mocks.isUserDeactivated }));

import { resolveUserId } from '../../src/mcp/auth';

describe('resolveUserId', () => {
	beforeEach(() => {
		mocks.isUserDeactivated.mockResolvedValue(false);
	});

	it.each([
		{ case: 'accepts a session', twoFactorSetupRequired: false, expected: 'user-1' },
		{
			case: 'rejects a session that must set up two-factor authentication',
			twoFactorSetupRequired: true,
			expected: null,
		},
	])('$case', async ({ twoFactorSetupRequired, expected }) => {
		mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, twoFactorSetupRequired });

		expect(await resolveUserId({ headers: {}, url: '/mcp' })).toBe(expected);
	});
});
