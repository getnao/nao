import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addOrgMemberIfMissing: vi.fn(),
	betterAuth: vi.fn(),
	buildVerifyEmail: vi.fn(),
	emailSend: vi.fn(),
	env: {
		BETTER_AUTH_SECRET: 'test-secret-at-least-twenty-characters',
		DEFAULT_USER_ROLE: 'user',
		ENABLE_USER_LOGIN: true,
		ENABLE_USER_SIGNUP: true,
		GOOGLE_CLIENT_ID: 'google-client',
		GOOGLE_CLIENT_SECRET: 'google-secret',
		MODE: 'test',
		NAO_MODE: 'cloud',
	},
	findOrganizationByEmailDomain: vi.fn(),
}));

vi.mock('better-auth', () => ({
	APIError: class APIError extends Error {},
	betterAuth: mocks.betterAuth,
}));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }));
vi.mock('better-auth/api', () => ({ createAuthMiddleware: vi.fn((handler) => handler) }));
vi.mock('better-auth/plugins', () => ({ jwt: vi.fn(() => ({})) }));
vi.mock('better-auth/plugins/bearer', () => ({ bearer: vi.fn(() => ({})) }));
vi.mock('@better-auth/oauth-provider', () => ({
	oauthProvider: vi.fn(() => ({})),
	oauthProviderAuthServerMetadata: vi.fn(),
	oauthProviderOpenIdConfigMetadata: vi.fn(),
}));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/db/dbConfig', () => ({
	default: { dialect: 'sqlite', schema: {} },
	Dialect: { Postgres: 'postgres' },
}));
vi.mock('../src/env', () => ({
	get env() {
		return mocks.env;
	},
	get isCloud() {
		return mocks.env.NAO_MODE === 'cloud';
	},
	MCP_VALID_AUDIENCES: [],
}));
vi.mock('../src/queries/organization.queries', () => ({
	findOrganizationByEmailDomain: mocks.findOrganizationByEmailDomain,
	getGoogleConfig: vi.fn().mockResolvedValue({ authDomains: '', clientId: '', clientSecret: '' }),
	initializePersonalOrganization: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({ listUserProjects: vi.fn() }));
vi.mock('../src/queries/user.queries', () => ({ countUsers: vi.fn().mockResolvedValue(0) }));
vi.mock('../src/services/auth-user-onboarding.service', () => ({
	initializeSelfHostedUserAfterCreation: vi.fn(),
}));
vi.mock('../src/services/credit-grant.service', () => ({
	activateUserJoinCandidates: vi.fn(),
}));
vi.mock('../src/services/email', () => ({ emailService: { sendEmail: mocks.emailSend } }));
vi.mock('../src/services/github', () => ({ githubOAuthConfig: vi.fn(() => null) }));
vi.mock('../src/services/gitlab', () => ({ gitlabOAuthConfig: vi.fn(() => null) }));
vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn().mockResolvedValue(false),
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../src/services/microsoft-auth.service', () => ({
	augmentSocialProvidersWithMicrosoft: vi.fn(),
	getTrustedProvidersForMicrosoft: vi.fn(() => []),
}));
vi.mock('../src/services/membership.service', () => ({
	addOrganizationMemberIfMissing: mocks.addOrgMemberIfMissing,
}));
vi.mock('../src/services/oidc-auth.service', () => ({
	augmentPluginsWithOidc: vi.fn(),
	getOidcProviderId: vi.fn(() => 'oidc'),
	getTrustedProvidersForOidc: vi.fn(() => []),
}));
vi.mock('../src/services/sso-login-sync.service', () => ({ syncSsoLoginGroups: vi.fn() }));
vi.mock('../src/services/sso-session.service', () => ({ shouldExpireSsoSession: vi.fn() }));
vi.mock('../src/utils/email-builders', () => ({
	buildForgotPasswordEmail: vi.fn(),
	buildVerifyEmail: mocks.buildVerifyEmail,
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
	serializeError: vi.fn(),
}));

import { getAuth, updateAuth } from '../src/auth';

interface CapturedAuthOptions {
	emailAndPassword: { requireEmailVerification: boolean };
	emailVerification:
		| {
				sendVerificationEmail: (data: { user: { email: string; name: string }; url: string }) => Promise<void>;
				sendOnSignUp: boolean;
				sendOnSignIn: boolean;
				autoSignInAfterVerification: boolean;
				expiresIn: number;
		  }
		| undefined;
	rateLimit: unknown;
}

describe('Cloud Google organization enrollment', () => {
	beforeEach(() => {
		mocks.env.NAO_MODE = 'cloud';
		updateAuth();
		mocks.addOrgMemberIfMissing.mockReset();
		mocks.betterAuth.mockReset().mockReturnValue({});
		mocks.buildVerifyEmail.mockReset().mockResolvedValue({ subject: 'Verify', html: '<p>Verify</p>' });
		mocks.emailSend.mockReset().mockResolvedValue(undefined);
		mocks.findOrganizationByEmailDomain.mockReset().mockResolvedValue({ id: 'matched-org' });
	});

	it('adds a matched organization member through the membership service', async () => {
		await getAuth();
		const options = mocks.betterAuth.mock.calls[0]?.[0] as {
			databaseHooks: {
				user: {
					create: {
						after: (
							user: { id: string; email: string },
							context: { params: { id: string } },
						) => Promise<void>;
					};
				};
			};
		};

		await options.databaseHooks.user.create.after(
			{ id: 'google-user', email: 'user@example.com' },
			{ params: { id: 'google' } },
		);

		expect(mocks.addOrgMemberIfMissing).toHaveBeenCalledWith({
			orgId: 'matched-org',
			userId: 'google-user',
			role: 'user',
		});
	});

	it('requires cloud email verification and limits resend requests', async () => {
		const options = await getAuthOptions();

		expect(options.emailAndPassword.requireEmailVerification).toBe(true);
		expect(options.emailVerification).toMatchObject({
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true,
			expiresIn: 3600,
		});
		expect(options.rateLimit).toEqual({
			enabled: true,
			customRules: {
				'/send-verification-email': {
					window: 60,
					max: 3,
				},
			},
		});
	});

	it('sends branded verification email and surfaces delivery failures', async () => {
		const options = await getAuthOptions();
		const user = { email: 'new@example.com', name: 'New User' };
		if (!options.emailVerification) {
			throw new Error('Expected cloud email verification options');
		}

		await options.emailVerification.sendVerificationEmail({ user, url: 'https://nao.test/verify' });

		expect(mocks.buildVerifyEmail).toHaveBeenCalledWith(user, 'https://nao.test/verify');
		expect(mocks.emailSend).toHaveBeenCalledWith(
			'new@example.com',
			{ subject: 'Verify', html: '<p>Verify</p>' },
			{ throwOnError: true },
		);

		mocks.emailSend.mockRejectedValueOnce(new Error('SMTP unavailable'));
		await expect(
			options.emailVerification.sendVerificationEmail({ user, url: 'https://nao.test/verify' }),
		).rejects.toThrow('SMTP unavailable');
	});

	it('leaves self-hosted email authentication unchanged', async () => {
		mocks.env.NAO_MODE = 'self-hosted';

		const options = await getAuthOptions();

		expect(options.emailAndPassword.requireEmailVerification).toBe(false);
		expect(options.emailVerification).toBeUndefined();
		expect(options.rateLimit).toBeUndefined();
	});
});

async function getAuthOptions(): Promise<CapturedAuthOptions> {
	updateAuth();
	await getAuth();
	return mocks.betterAuth.mock.calls.at(-1)?.[0] as CapturedAuthOptions;
}
