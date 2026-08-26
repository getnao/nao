import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSession: vi.fn(),
	createVerificationValue: vi.fn(),
	findVerificationValue: vi.fn(),
	deleteVerificationByIdentifier: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getAuth: vi.fn(async () => ({
		$context: Promise.resolve({ internalAdapter: mocks }),
	})),
}));

import { createCliAuthorizationCode, exchangeCliAuthorizationCode } from '../src/services/cli-auth.service';

describe('cli-auth service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a session and a one-time code for the user', async () => {
		mocks.createSession.mockResolvedValue({ token: 'session-token' });
		mocks.createVerificationValue.mockResolvedValue({});

		const code = await createCliAuthorizationCode('user-1');

		expect(code).toBeTruthy();
		expect(mocks.createSession).toHaveBeenCalledWith('user-1', false, { userAgent: 'nao-cli' });
		expect(mocks.createVerificationValue).toHaveBeenCalledWith({
			identifier: `cli-auth:${code}`,
			value: 'session-token',
			expiresAt: expect.any(Date),
		});
		const { expiresAt } = mocks.createVerificationValue.mock.calls[0][0];
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('exchanges a valid code for the session token and consumes it', async () => {
		mocks.findVerificationValue.mockResolvedValue({
			identifier: 'cli-auth:some-code',
			value: 'session-token',
			expiresAt: new Date(Date.now() + 60_000),
		});

		const token = await exchangeCliAuthorizationCode('some-code');

		expect(token).toBe('session-token');
		expect(mocks.findVerificationValue).toHaveBeenCalledWith('cli-auth:some-code');
		expect(mocks.deleteVerificationByIdentifier).toHaveBeenCalledWith('cli-auth:some-code');
	});

	it('returns null for an unknown code', async () => {
		mocks.findVerificationValue.mockResolvedValue(null);

		expect(await exchangeCliAuthorizationCode('unknown')).toBeNull();
		expect(mocks.deleteVerificationByIdentifier).not.toHaveBeenCalled();
	});

	it('returns null for an expired code and still consumes it', async () => {
		mocks.findVerificationValue.mockResolvedValue({
			identifier: 'cli-auth:expired-code',
			value: 'session-token',
			expiresAt: new Date(Date.now() - 1_000),
		});

		expect(await exchangeCliAuthorizationCode('expired-code')).toBeNull();
		expect(mocks.deleteVerificationByIdentifier).toHaveBeenCalledWith('cli-auth:expired-code');
	});
});
