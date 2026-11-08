import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricDecrypt } from 'better-auth/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TwoFactorMethod } from '../src/types/two-factor';

type MemoryRecord = Record<string, unknown>;

const state = vi.hoisted(() => ({
	db: {} as Record<string, MemoryRecord[]>,
	policies: [] as TwoFactorMethod[][],
	emailEnabled: true,
	sentCodes: [] as string[],
}));

vi.mock('../src/queries/two-factor.queries', () => ({
	getTwoFactorEnrollment: vi.fn(async (userId: string) => {
		const user = state.db.user.find((row) => row.id === userId);
		if (!user) {
			return null;
		}
		const secret = state.db.twoFactor.find((row) => row.userId === userId);
		return { enabled: Boolean(user.twoFactorEnabled), totpVerified: secret ? Boolean(secret.verified) : null };
	}),
	listUserOrganizationsTwoFactorMethods: vi.fn(async () => state.policies),
}));

vi.mock('../src/queries/account.queries', () => ({
	getAccountById: vi.fn(async () => ({ id: 'account-1', password: 'hash' })),
}));

vi.mock('../src/services/branding.service', () => ({ DEFAULT_APP_NAME: 'nao' }));

vi.mock('../src/services/email', () => ({
	emailService: {
		isEnabled: () => state.emailEnabled,
		sendEmail: vi.fn(async (_to: string, email: { html: string }) => {
			state.sentCodes.push(email.html);
		}),
	},
}));

vi.mock('../src/utils/email-builders', () => ({
	buildTwoFactorCodeEmail: vi.fn(async (_user: unknown, code: string) => ({ subject: 'code', html: code })),
}));

const { twoFactorPlugins } = await import('../src/services/two-factor-auth.service');

const BASE_URL = 'http://localhost:3000';
const AUTH_SECRET = 'test-secret-that-is-long-enough-for-better-auth';
const PASSWORD = 'correct-horse-battery';

describe('two-factor authentication policy', () => {
	let auth: ReturnType<typeof createAuth>;

	beforeEach(() => {
		state.db = { user: [], session: [], account: [], verification: [], twoFactor: [] };
		state.policies = [['totp', 'email']];
		state.emailEnabled = true;
		state.sentCodes = [];
		auth = createAuth();
	});

	it('enrolls an authenticator app and requires it at sign-in', async () => {
		const browser = new Browser(auth);
		await browser.signUp('app@example.com');

		await browser.json('/two-factor/enable', { password: PASSWORD });
		expect(
			(await browser.post('/two-factor/verify-totp', { code: await totpCode(auth, 'app@example.com') })).status,
		).toBe(200);

		const signIn = new Browser(auth);
		const challenge = await signIn.json('/sign-in/email', { email: 'app@example.com', password: PASSWORD });
		expect(challenge.twoFactorRedirect).toBe(true);
		expect(challenge.twoFactorMethods).toContain('totp');

		expect((await signIn.post('/two-factor/send-otp', {})).status).toBe(403);
		expect(
			(await signIn.post('/two-factor/verify-totp', { code: await totpCode(auth, 'app@example.com') })).status,
		).toBe(200);
		expect((await signIn.json('/get-session')).user.email).toBe('app@example.com');
	});

	it('enrolls email codes and signs in with an emailed code', async () => {
		state.policies = [['email']];
		const browser = new Browser(auth);
		await browser.signUp('email@example.com');

		await browser.json('/two-factor/enable', { password: PASSWORD });
		await browser.json('/two-factor/send-otp', {});
		expect((await browser.post('/two-factor/verify-otp', { code: state.sentCodes.at(-1) })).status).toBe(200);

		const signIn = new Browser(auth);
		const challenge = await signIn.json('/sign-in/email', { email: 'email@example.com', password: PASSWORD });
		expect(challenge.twoFactorMethods).toEqual(['otp']);

		await signIn.json('/two-factor/send-otp', {});
		expect((await signIn.post('/two-factor/verify-otp', { code: state.sentCodes.at(-1) })).status).toBe(200);
		expect((await signIn.json('/get-session')).user.email).toBe('email@example.com');
	});

	it('rejects enrolling an authenticator app the organization does not allow', async () => {
		state.policies = [['email']];
		const browser = new Browser(auth);
		await browser.signUp('blocked-app@example.com');

		await browser.json('/two-factor/enable', { password: PASSWORD });
		const response = await browser.post('/two-factor/verify-totp', {
			code: await totpCode(auth, 'blocked-app@example.com'),
		});

		expect(response.status).toBe(403);
		expect(state.db.user[0].twoFactorEnabled).toBe(false);
	});

	it('rejects email codes when no email provider is configured', async () => {
		state.emailEnabled = false;
		const browser = new Browser(auth);
		await browser.signUp('no-smtp@example.com');

		await browser.json('/two-factor/enable', { password: PASSWORD });

		expect((await browser.post('/two-factor/send-otp', {})).status).toBe(403);
	});

	it('uses the methods every organization of the user allows', async () => {
		state.policies = [['totp', 'email'], ['email']];
		const browser = new Browser(auth);
		await browser.signUp('multi-org@example.com');

		await browser.json('/two-factor/enable', { password: PASSWORD });

		expect(
			(await browser.post('/two-factor/verify-totp', { code: await totpCode(auth, 'multi-org@example.com') }))
				.status,
		).toBe(403);
	});

	it('refuses to start a setup when no method is allowed', async () => {
		state.policies = [[]];
		const browser = new Browser(auth);
		await browser.signUp('none@example.com');

		expect((await browser.post('/two-factor/enable', { password: PASSWORD })).status).toBe(403);
	});
});

function createAuth() {
	return betterAuth({
		secret: AUTH_SECRET,
		baseURL: BASE_URL,
		basePath: '/api/auth',
		database: memoryAdapter(state.db),
		emailAndPassword: { enabled: true },
		plugins: twoFactorPlugins(),
	});
}

async function totpCode(auth: ReturnType<typeof createAuth>, userEmail: string): Promise<string> {
	const user = state.db.user.find((row) => row.email === userEmail)!;
	const stored = state.db.twoFactor.find((row) => row.userId === user.id)!;
	const secret = await symmetricDecrypt({ key: AUTH_SECRET, data: stored.secret as string });
	const api = auth.api as unknown as {
		generateTOTP: (input: { body: { secret: string } }) => Promise<{ code: string }>;
	};
	return (await api.generateTOTP({ body: { secret } })).code;
}

/** Sends requests to the auth handler and keeps cookies between them, like a browser. */
class Browser {
	private readonly cookies = new Map<string, string>();

	constructor(private readonly auth: ReturnType<typeof createAuth>) {}

	async signUp(email: string): Promise<void> {
		await this.json('/sign-up/email', { email, password: PASSWORD, name: 'Test User' });
	}

	async json(path: string, body?: object) {
		const response = await this.post(path, body);
		expect(response.status, `${path} responded ${response.status}`).toBe(200);
		return response.json();
	}

	async post(path: string, body?: object): Promise<Response> {
		const response = await this.auth.handler(
			new Request(`${BASE_URL}/api/auth${path}`, {
				method: body ? 'POST' : 'GET',
				headers: { 'content-type': 'application/json', origin: BASE_URL, cookie: this.cookieHeader() },
				body: body ? JSON.stringify(body) : undefined,
			}),
		);
		this.storeCookies(response);
		return response;
	}

	private cookieHeader(): string {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	private storeCookies(response: Response): void {
		for (const cookie of response.headers.getSetCookie()) {
			const [pair, ...attributes] = cookie.split(';');
			const [name, value] = pair.split(/=(.*)/s);
			const isExpired = !value || attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0');
			if (isExpired) {
				this.cookies.delete(name);
			} else {
				this.cookies.set(name, value);
			}
		}
	}
}
