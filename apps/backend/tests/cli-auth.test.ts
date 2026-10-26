import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSession: vi.fn(),
	createVerificationValue: vi.fn(),
	consumeVerificationValue: vi.fn(),
	isTrustedOrigin: vi.fn(),
	authMiddleware: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getAuth: vi.fn(async () => ({
		$context: Promise.resolve({
			internalAdapter: {
				createSession: mocks.createSession,
				createVerificationValue: mocks.createVerificationValue,
				consumeVerificationValue: mocks.consumeVerificationValue,
			},
			isTrustedOrigin: mocks.isTrustedOrigin,
		}),
	})),
}));

vi.mock('../src/middleware/auth', () => ({ authMiddleware: mocks.authMiddleware }));

import { cliAuthRoutes } from '../src/routes/cli-auth';
import {
	consumeAuthorizationCode,
	createAuthorizationCode,
	exchangeCliAuthorizationCode,
} from '../src/services/cli-auth.service';

const TRUSTED_ORIGIN = 'http://localhost:5005';

describe('cli-auth service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a one-time code for the user without minting a session yet', async () => {
		mocks.createVerificationValue.mockResolvedValue({});

		const code = await createAuthorizationCode('user-1', 'cli');

		expect(code).toBeTruthy();
		expect(mocks.createSession).not.toHaveBeenCalled();
		expect(mocks.createVerificationValue).toHaveBeenCalledWith({
			identifier: `cli-auth:${code}`,
			value: 'user-1',
			expiresAt: expect.any(Date),
		});
		const { expiresAt } = mocks.createVerificationValue.mock.calls[0][0];
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('stores desktop codes under their own identifier prefix', async () => {
		mocks.createVerificationValue.mockResolvedValue({});

		const code = await createAuthorizationCode('user-1', 'desktop');

		expect(mocks.createVerificationValue).toHaveBeenCalledWith(
			expect.objectContaining({ identifier: `desktop-auth:${code}` }),
		);
	});

	it('consumes codes from the namespace of the requested client', async () => {
		mocks.consumeVerificationValue.mockResolvedValue(null);

		expect(await consumeAuthorizationCode('some-code', 'desktop')).toBeNull();
		expect(mocks.consumeVerificationValue).toHaveBeenCalledWith('desktop-auth:some-code');
	});

	it('exchanges a valid code for a new CLI session token and consumes it', async () => {
		mocks.consumeVerificationValue.mockResolvedValue({
			identifier: 'cli-auth:some-code',
			value: 'user-1',
			expiresAt: new Date(Date.now() + 60_000),
		});
		mocks.createSession.mockResolvedValue({ token: 'session-token' });

		const token = await exchangeCliAuthorizationCode('some-code');

		expect(token).toBe('session-token');
		expect(mocks.consumeVerificationValue).toHaveBeenCalledWith('cli-auth:some-code');
		expect(mocks.createSession).toHaveBeenCalledWith('user-1', false, { userAgent: 'nao-cli' });
	});

	it('returns null for an unknown or already used code', async () => {
		mocks.consumeVerificationValue.mockResolvedValue(null);

		expect(await exchangeCliAuthorizationCode('unknown')).toBeNull();
		expect(mocks.createSession).not.toHaveBeenCalled();
	});

	it('returns null for an expired code', async () => {
		mocks.consumeVerificationValue.mockResolvedValue({
			identifier: 'cli-auth:expired-code',
			value: 'user-1',
			expiresAt: new Date(Date.now() - 1_000),
		});

		expect(await exchangeCliAuthorizationCode('expired-code')).toBeNull();
		expect(mocks.consumeVerificationValue).toHaveBeenCalledWith('cli-auth:expired-code');
		expect(mocks.createSession).not.toHaveBeenCalled();
	});
});

describe('cli-auth authorize route', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.isTrustedOrigin.mockImplementation((origin: string) => origin === TRUSTED_ORIGIN);
		mocks.authMiddleware.mockImplementation(async (request: { user: { id: string } }) => {
			request.user = { id: 'user-1' };
		});
		mocks.createVerificationValue.mockResolvedValue({});

		app = Fastify();
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		await app.register(cliAuthRoutes as never, { prefix: '/api/cli-auth' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	async function authorize(headers: Record<string, string>, payload?: object) {
		return app.inject({ method: 'POST', url: '/api/cli-auth/authorize', headers, payload });
	}

	function mintedIdentifier(): string {
		return mocks.createVerificationValue.mock.calls[0][0].identifier;
	}

	it('mints a CLI code for a browser session from a trusted origin', async () => {
		const res = await authorize({ origin: TRUSTED_ORIGIN, cookie: 'session=abc' });

		expect(res.statusCode).toBe(200);
		expect(res.json().code).toBeTruthy();
		expect(mocks.createVerificationValue).toHaveBeenCalledOnce();
		expect(mintedIdentifier()).toBe(`cli-auth:${res.json().code}`);
	});

	it('mints a desktop code when the desktop client asks for one', async () => {
		const res = await authorize({ origin: TRUSTED_ORIGIN, cookie: 'session=abc' }, { client: 'desktop' });

		expect(res.statusCode).toBe(200);
		expect(mintedIdentifier()).toBe(`desktop-auth:${res.json().code}`);
	});

	it('rejects unknown client kinds', async () => {
		const res = await authorize({ origin: TRUSTED_ORIGIN, cookie: 'session=abc' }, { client: 'mobile' });

		expect(res.statusCode).toBe(400);
		expect(mocks.createVerificationValue).not.toHaveBeenCalled();
	});

	it('rejects bearer-token sessions so a token cannot renew itself', async () => {
		const res = await authorize({ origin: TRUSTED_ORIGIN, authorization: 'Bearer cli-token' });

		expect(res.statusCode).toBe(403);
		expect(mocks.authMiddleware).not.toHaveBeenCalled();
		expect(mocks.createVerificationValue).not.toHaveBeenCalled();
	});

	it('rejects bearer-token sessions for desktop codes too', async () => {
		const res = await authorize(
			{ origin: TRUSTED_ORIGIN, authorization: 'Bearer cli-token' },
			{ client: 'desktop' },
		);

		expect(res.statusCode).toBe(403);
		expect(mocks.authMiddleware).not.toHaveBeenCalled();
		expect(mocks.createVerificationValue).not.toHaveBeenCalled();
	});

	it('rejects requests from an untrusted origin', async () => {
		const res = await authorize({ origin: 'https://evil.example', cookie: 'session=abc' });

		expect(res.statusCode).toBe(403);
		expect(mocks.authMiddleware).not.toHaveBeenCalled();
		expect(mocks.createVerificationValue).not.toHaveBeenCalled();
	});

	it('rejects requests without an origin header', async () => {
		const res = await authorize({ cookie: 'session=abc' });

		expect(res.statusCode).toBe(403);
		expect(mocks.createVerificationValue).not.toHaveBeenCalled();
	});
});
