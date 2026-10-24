import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	auth: null as unknown,
	userId: '',
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn(async () => mocks.auth) }));

vi.mock('../src/middleware/auth', () => ({
	authMiddleware: vi.fn(async (request: { user: { id: string } }) => {
		request.user = { id: mocks.userId };
	}),
}));

import { cliAuthRoutes, desktopAuthRoutes } from '../src/routes/cli-auth';
import { desktopAuthPlugin } from '../src/services/desktop-auth.service';

const SECRET = 'desktop-auth-test-secret-with-enough-entropy';
const EXPIRED_REDIRECT = '/login?error=desktop_auth_expired';
const CODE_LIFETIME_MS = 5 * 60 * 1000;

type TestAuth = ReturnType<typeof createTestAuth>;

describe('desktop auth session endpoint', () => {
	let app: FastifyInstance;
	let auth: TestAuth;

	beforeEach(async () => {
		auth = await useServer('http://localhost:5005');
		app = await buildApp();
	});

	afterEach(async () => {
		vi.useRealTimers();
		await app.close();
	});

	it('sets the better-auth session cookie for a valid desktop code and redirects to the app', async () => {
		const code = await mintCode(app, 'desktop');

		const res = await redeemDesktopCode(app, code);

		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('/');
		expect(res.headers['referrer-policy']).toBe('no-referrer');

		const context = await auth.$context;
		const cookie = sessionCookie(res);
		expect(cookie.name).toBe(context.authCookies.sessionToken.name);
		expect(cookie.attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));

		const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.pair }) });
		expect(session?.user.id).toBe(mocks.userId);
		expect(session?.session.userAgent).toBe('nao-desktop');
	});

	it('uses the secure, prefixed cookie on https servers', async () => {
		auth = await useServer('https://nao.example.com');
		const code = await mintCode(app, 'desktop', 'https://nao.example.com');

		const cookie = sessionCookie(await redeemDesktopCode(app, code));

		expect(cookie.name).toBe('__Secure-better-auth.session_token');
		expect(cookie.attributes).toContain('secure');
	});

	it('rejects a code that was already used', async () => {
		const code = await mintCode(app, 'desktop');
		await redeemDesktopCode(app, code);

		const res = await redeemDesktopCode(app, code);

		expectExpiredRedirect(res);
	});

	it('rejects an expired code', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const code = await mintCode(app, 'desktop');
		vi.setSystemTime(Date.now() + CODE_LIFETIME_MS + 1_000);

		const res = await redeemDesktopCode(app, code);

		expectExpiredRedirect(res);
	});

	it('rejects an unknown code', async () => {
		expectExpiredRedirect(await redeemDesktopCode(app, 'not-a-real-code'));
	});

	it('rejects a request without a code', async () => {
		expectExpiredRedirect(await app.inject({ method: 'GET', url: '/api/desktop-auth/session' }));
	});

	it('rejects a CLI code without consuming it', async () => {
		const code = await mintCode(app, 'cli');

		expectExpiredRedirect(await redeemDesktopCode(app, code));

		const tokenRes = await exchangeForToken(app, code);
		expect(tokenRes.statusCode).toBe(200);
	});

	it('is not reachable through the better-auth router', async () => {
		const code = await mintCode(app, 'desktop');

		const res = await auth.handler(new Request(`http://localhost:5005/api/auth/desktop-auth/session?code=${code}`));

		expect(res.status).toBe(404);
		expect(res.headers.get('set-cookie')).toBeNull();
	});
});

describe('cli token endpoint', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		await useServer('http://localhost:5005');
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it('rejects a desktop code without consuming it', async () => {
		const code = await mintCode(app, 'desktop');

		const tokenRes = await exchangeForToken(app, code);
		expect(tokenRes.statusCode).toBe(400);

		const res = await redeemDesktopCode(app, code);
		expect(res.headers.location).toBe('/');
	});

	it('still exchanges a CLI code for a bearer token', async () => {
		const code = await mintCode(app, 'cli');

		const res = await exchangeForToken(app, code);

		expect(res.statusCode).toBe(200);
		expect(res.json().token).toEqual(expect.any(String));
	});
});

function createTestAuth(baseURL: string) {
	return betterAuth({
		secret: SECRET,
		baseURL,
		basePath: '/api/auth',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		plugins: [desktopAuthPlugin()],
		logger: { disabled: true },
	});
}

async function useServer(baseURL: string): Promise<TestAuth> {
	const auth = createTestAuth(baseURL);
	const context = await auth.$context;
	const user = await context.internalAdapter.createUser({ email: 'ada@example.com', name: 'Ada' });
	mocks.auth = auth;
	mocks.userId = user.id;
	return auth;
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	await app.register(cliAuthRoutes as never, { prefix: '/api/cli-auth' });
	await app.register(desktopAuthRoutes as never, { prefix: '/api/desktop-auth' });
	await app.ready();
	return app;
}

async function mintCode(app: FastifyInstance, client: 'cli' | 'desktop', origin = 'http://localhost:5005') {
	const res = await app.inject({
		method: 'POST',
		url: '/api/cli-auth/authorize',
		headers: { origin, cookie: 'session=browser' },
		payload: { client },
	});
	expect(res.statusCode).toBe(200);
	return res.json().code as string;
}

function redeemDesktopCode(app: FastifyInstance, code: string) {
	return app.inject({ method: 'GET', url: `/api/desktop-auth/session?code=${encodeURIComponent(code)}` });
}

function exchangeForToken(app: FastifyInstance, code: string) {
	return app.inject({ method: 'POST', url: '/api/cli-auth/token', payload: { code } });
}

function expectExpiredRedirect(res: Awaited<ReturnType<typeof redeemDesktopCode>>) {
	expect(res.statusCode).toBe(302);
	expect(res.headers.location).toBe(EXPIRED_REDIRECT);
	expect(res.headers['set-cookie']).toBeUndefined();
}

function sessionCookie(res: Awaited<ReturnType<typeof redeemDesktopCode>>) {
	const header = [res.headers['set-cookie'] ?? []].flat().find((value) => value.includes('session_token='));
	expect(header).toBeDefined();
	const [pair, ...attributes] = header!.split(';').map((part) => part.trim());
	return {
		pair,
		name: pair.split('=')[0],
		attributes: attributes.map((attribute) => attribute.toLowerCase()),
	};
}
