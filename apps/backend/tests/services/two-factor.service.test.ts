import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricDecrypt } from 'better-auth/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MemoryRecord = Record<string, unknown>;

const state = vi.hoisted(() => ({
	db: {} as Record<string, MemoryRecord[]>,
	policy: { required: false, emailCodes: true },
	hasPassword: true,
	emailEnabled: true,
	sentCodes: [] as string[],
}));

vi.mock('../../src/queries/two-factor.queries', () => ({
	getTwoFactorEnrollment: vi.fn(async (userId: string) => {
		const user = state.db.user.find((row) => row.id === userId);
		const secret = state.db.twoFactor.find((row) => row.userId === userId);
		return user && { enabled: !!user.twoFactorEnabled, totpVerified: secret ? !!secret.verified : null };
	}),
	getUserTwoFactorPolicy: vi.fn(async () => state.policy),
}));
vi.mock('../../src/queries/account.queries', () => ({
	getAccountById: vi.fn(async () => ({ id: 'account-1', password: state.hasPassword ? 'hash' : null })),
}));
vi.mock('../../src/services/branding.service', () => ({ DEFAULT_APP_NAME: 'nao' }));
vi.mock('../../src/services/email', () => ({
	emailService: {
		isEnabled: () => state.emailEnabled,
		sendEmail: vi.fn(async (_to: string, email: { subject: string }) => {
			state.sentCodes.push(email.subject);
		}),
	},
}));
vi.mock('../../src/utils/email-builders', () => ({
	buildNotificationEmail: vi.fn(async (_user: unknown, title: string) => ({ subject: title.replace(/\D/g, '') })),
}));

const twoFactorQueries = await import('../../src/queries/two-factor.queries');
const { getTwoFactorStatus, isTwoFactorSetupRequired, twoFactorPlugin } =
	await import('../../src/services/two-factor.service');

const BASE_URL = 'http://localhost:3000';
const AUTH_SECRET = 'test-secret-that-is-long-enough-for-better-auth';
const PASSWORD = 'correct-horse-battery';
const EMAIL = 'member@example.com';

let auth: ReturnType<typeof createAuth>;

beforeEach(() => {
	vi.clearAllMocks();
	state.db = { user: [], session: [], account: [], verification: [], twoFactor: [] };
	state.policy = { required: false, emailCodes: true };
	state.hasPassword = true;
	state.emailEnabled = true;
	state.sentCodes = [];
	auth = createAuth();
});

describe('two-factor sign-in', () => {
	it('asks an authenticator app user for an app code, and never emails them one', async () => {
		const setup = await startSetup();
		await setup.json('/two-factor/verify-totp', { code: await totpCode() });

		const signIn = new Browser();
		const challenge = await signIn.json('/sign-in/email', { email: EMAIL, password: PASSWORD });
		await signIn.json('/two-factor/send-otp', {});

		expect(challenge).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ['totp', 'otp'] });
		expect(state.sentCodes).toEqual([]);
		await signIn.json('/two-factor/verify-totp', { code: await totpCode() });
		expect((await signIn.json('/get-session')).user.email).toBe(EMAIL);
	});

	it('keeps emailing codes to a user set up with them, even once their organization forbids new ones', async () => {
		const setup = await startSetup();
		await setup.json('/two-factor/send-otp', {});
		await setup.json('/two-factor/verify-otp', { code: state.sentCodes.at(-1) });
		state.policy.emailCodes = false;

		const signIn = new Browser();
		const challenge = await signIn.json('/sign-in/email', { email: EMAIL, password: PASSWORD });
		await signIn.json('/two-factor/send-otp', {});

		expect(challenge.twoFactorMethods).toEqual(['otp']);
		expect(state.sentCodes).toHaveLength(2);
		await signIn.json('/two-factor/verify-otp', { code: state.sentCodes.at(-1) });
		expect((await signIn.json('/get-session')).user.email).toBe(EMAIL);
	});

	it.each([
		{ reason: 'the organization forbids email codes', policy: { required: false, emailCodes: false } },
		{ reason: 'no email provider is configured', emailEnabled: false },
	])('does not email a setup code when $reason', async ({ policy = state.policy, emailEnabled = true }) => {
		state.policy = policy;
		state.emailEnabled = emailEnabled;
		const setup = await startSetup();

		await setup.json('/two-factor/send-otp', {});

		expect(state.sentCodes).toEqual([]);
		expect((await getTwoFactorStatus(userId())).emailCodesAllowed).toBe(false);
	});
});

describe('required two-factor setup', () => {
	it.each([
		{ case: 'a password member without a second factor', expected: true },
		{ case: 'a member of organizations that do not require it', required: false, expected: false },
		{ case: 'an SSO-only member', hasPassword: false, expected: false },
		{ case: 'a member who already set it up', enabled: true, expected: false },
	])('is $expected for $case', async ({ required = true, hasPassword = true, enabled = false, expected }) => {
		state.policy.required = required;
		state.hasPassword = hasPassword;
		state.db.user.push({ id: 'user-1', twoFactorEnabled: enabled });

		expect((await getTwoFactorStatus('user-1')).setupRequired).toBe(expected);
		expect(await isTwoFactorSetupRequired({ id: 'user-1', twoFactorEnabled: enabled })).toBe(expected);
	});

	it('skips every lookup for a session that already has a second factor', async () => {
		await isTwoFactorSetupRequired({ id: 'user-1', twoFactorEnabled: true });

		expect(twoFactorQueries.getUserTwoFactorPolicy).not.toHaveBeenCalled();
	});
});

function createAuth() {
	return betterAuth({
		secret: AUTH_SECRET,
		baseURL: BASE_URL,
		basePath: '/api/auth',
		database: memoryAdapter(state.db),
		emailAndPassword: { enabled: true },
		plugins: [twoFactorPlugin()],
	});
}

async function startSetup(): Promise<Browser> {
	const browser = new Browser();
	await browser.json('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Member' });
	await browser.json('/two-factor/enable', { password: PASSWORD });
	return browser;
}

function userId(): string {
	return state.db.user[0].id as string;
}

async function totpCode(): Promise<string> {
	const secret = await symmetricDecrypt({ key: AUTH_SECRET, data: state.db.twoFactor[0].secret as string });
	const api = auth.api as unknown as {
		generateTOTP: (input: { body: { secret: string } }) => Promise<{ code: string }>;
	};
	return (await api.generateTOTP({ body: { secret } })).code;
}

/** Sends requests to the auth handler and keeps cookies between them, like a browser. */
class Browser {
	private readonly cookies = new Map<string, string>();

	async json(path: string, body?: object) {
		const response = await auth.handler(
			new Request(`${BASE_URL}/api/auth${path}`, {
				method: body ? 'POST' : 'GET',
				headers: { 'content-type': 'application/json', origin: BASE_URL, cookie: this.cookieHeader() },
				body: body && JSON.stringify(body),
			}),
		);
		this.storeCookies(response);
		expect(response.status, `${path} responded ${response.status}`).toBe(200);
		return response.json();
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
