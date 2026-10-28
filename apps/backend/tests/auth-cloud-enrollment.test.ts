import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addOrgMemberIfMissing: vi.fn(),
	betterAuth: vi.fn(),
	buildAccountExistsEmail: vi.fn(),
	buildVerifyEmail: vi.fn(),
	emailSend: vi.fn(),
	emailIsEnabled: vi.fn(),
	enqueueOnce: vi.fn(),
	env: {
		BETTER_AUTH_SECRET: 'test-secret-at-least-twenty-characters',
		CLOUD_BILLING_ENABLED: true,
		DEFAULT_USER_ROLE: 'user',
		ENABLE_USER_LOGIN: true,
		ENABLE_USER_SIGNUP: true,
		GOOGLE_CLIENT_ID: 'google-client',
		GOOGLE_CLIENT_SECRET: 'google-secret',
		MODE: 'test',
		NAO_MODE: 'cloud',
		SMTP_HOST: 'smtp.example.com',
		SMTP_MAIL_FROM: 'hello@example.com',
		SMTP_PASSWORD: 'secret',
	},
	findOrganizationByEmailDomain: vi.fn(),
	getUser: vi.fn(),
	markEmailVerified: vi.fn(),
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
	isCloudWelcomeEmailEnabled: () =>
		mocks.env.NAO_MODE === 'cloud' &&
		mocks.env.CLOUD_BILLING_ENABLED &&
		Boolean(mocks.env.SMTP_HOST && mocks.env.SMTP_MAIL_FROM && mocks.env.SMTP_PASSWORD),
	MCP_VALID_AUDIENCES: [],
	MCP_PUBLIC_ORIGIN: undefined,
	MCP_PUBLIC_SERVER_URL: undefined,
	isMcpPublicHost: () => false,
}));
vi.mock('../src/queries/organization.queries', () => ({
	findOrganizationByEmailDomain: mocks.findOrganizationByEmailDomain,
	getGoogleConfig: vi.fn().mockResolvedValue({ authDomains: '', clientId: '', clientSecret: '' }),
	initializePersonalOrganization: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({ listUserProjects: vi.fn() }));
vi.mock('../src/queries/user.queries', () => ({
	countUsers: vi.fn().mockResolvedValue(0),
	getUser: mocks.getUser,
	markEmailVerified: mocks.markEmailVerified,
}));
vi.mock('../src/services/auth-user-onboarding.service', () => ({
	initializeSelfHostedUserAfterCreation: vi.fn(),
}));
vi.mock('../src/services/credit-grant.service', () => ({
	activateUserJoinCandidates: vi.fn(),
}));
vi.mock('../src/services/email', () => ({
	emailService: { isEnabled: mocks.emailIsEnabled, sendEmail: mocks.emailSend },
}));
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
vi.mock('../src/services/scheduler.service', () => ({ enqueueOnce: mocks.enqueueOnce }));
vi.mock('../src/services/sso-login-sync.service', () => ({ syncSsoLoginGroups: vi.fn() }));
vi.mock('../src/services/sso-session.service', () => ({ shouldExpireSsoSession: vi.fn() }));
vi.mock('../src/utils/email-builders', () => ({
	buildAccountExistsEmail: mocks.buildAccountExistsEmail,
	buildForgotPasswordEmail: vi.fn(),
	buildVerifyEmail: mocks.buildVerifyEmail,
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
	serializeError: vi.fn(),
}));

import { getAuth, updateAuth } from '../src/auth';

interface ExistingUser {
	email: string;
	name: string;
	emailVerified: boolean;
}

interface CapturedAuthOptions {
	databaseHooks: {
		user: {
			create: {
				after: (user: { id: string; email: string }, context: { params: { id: string } }) => Promise<void>;
			};
		};
	};
	emailAndPassword: {
		requireEmailVerification: boolean;
		onPasswordReset: (data: { user: { id: string; emailVerified: boolean } }) => Promise<void>;
		onExistingUserSignUp: (data: { user: ExistingUser }, request?: Request) => Promise<void>;
	};
	hooks: {
		after: (ctx: {
			path: string;
			body: { email: string };
			context: {
				returned: unknown;
				internalAdapter: { findUserByEmail: (email: string) => Promise<{ user: ExistingUser } | null> };
			};
		}) => Promise<void>;
	};
	emailVerification:
		| {
				sendVerificationEmail: (data: { user: { email: string; name: string }; url: string }) => Promise<void>;
				sendOnSignUp: boolean;
				autoSignInAfterVerification: boolean;
				expiresIn: number;
				afterEmailVerification: (user: { id: string }) => Promise<void>;
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
		mocks.emailIsEnabled.mockReset().mockReturnValue(true);
		mocks.emailSend.mockReset().mockResolvedValue(undefined);
		mocks.enqueueOnce.mockReset().mockResolvedValue(undefined);
		mocks.findOrganizationByEmailDomain.mockReset().mockResolvedValue({ id: 'matched-org' });
		mocks.getUser.mockReset().mockImplementation(async ({ id }: { id: string }) => ({
			id,
			email: `${id}@example.com`,
			emailVerified: true,
			requiresPasswordReset: false,
		}));
		mocks.markEmailVerified.mockReset().mockResolvedValue(true);
	});

	it('adds a matched organization member and queues a welcome for a verified social user', async () => {
		const options = await getAuthOptions();

		await options.databaseHooks.user.create.after(
			{ id: 'google-user', email: 'user@example.com' },
			{ params: { id: 'google' } },
		);

		expect(mocks.addOrgMemberIfMissing).toHaveBeenCalledWith({
			orgId: 'matched-org',
			userId: 'google-user',
			role: 'user',
		});
		expect(mocks.enqueueOnce).toHaveBeenCalledWith({
			name: 'email.cloud.welcome',
			payload: { kind: 'user', userId: 'google-user' },
			uniqueKey: 'email-cloud-welcome-user:google-user',
		});
	});

	it('requires cloud email verification and limits resend requests', async () => {
		const options = await getAuthOptions();

		expect(options.emailAndPassword.requireEmailVerification).toBe(true);
		expect(options.emailVerification).toMatchObject({
			sendOnSignUp: true,
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

		await options.emailVerification?.afterEmailVerification({ id: 'verified-user' });
		expect(mocks.enqueueOnce).toHaveBeenCalledWith({
			name: 'email.cloud.welcome',
			payload: { kind: 'user', userId: 'verified-user' },
			uniqueKey: 'email-cloud-welcome-user:verified-user',
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

	it('does not require email verification when SMTP is not configured', async () => {
		mocks.emailIsEnabled.mockReturnValue(false);

		const options = await getAuthOptions();

		expect(options.emailAndPassword.requireEmailVerification).toBe(false);
		expect(options.emailVerification).toBeUndefined();
	});

	it('welcomes a self-signed-up user only when password reset first verifies their email', async () => {
		const options = await getAuthOptions();

		await options.emailAndPassword.onPasswordReset({ user: { id: 'unverified-user', emailVerified: false } });
		await options.emailAndPassword.onPasswordReset({ user: { id: 'verified-user', emailVerified: true } });

		expect(mocks.markEmailVerified).toHaveBeenCalledExactlyOnceWith('unverified-user');
		expect(mocks.enqueueOnce).toHaveBeenCalledExactlyOnceWith({
			name: 'email.cloud.welcome',
			payload: { kind: 'user', userId: 'unverified-user' },
			uniqueKey: 'email-cloud-welcome-user:unverified-user',
		});

		mocks.getUser.mockResolvedValueOnce({
			id: 'invited-user',
			email: 'invited@example.com',
			emailVerified: true,
			requiresPasswordReset: true,
		});
		await options.emailAndPassword.onPasswordReset({ user: { id: 'invited-user', emailVerified: false } });

		expect(mocks.enqueueOnce).toHaveBeenCalledTimes(1);
	});

	it('always emails the owner of an existing account who signs up again or asks for another email', async () => {
		const sendVerificationEmail = vi.fn();
		mocks.betterAuth.mockReturnValue({ api: { sendVerificationEmail } });
		mocks.buildAccountExistsEmail.mockResolvedValue({ subject: 'Exists', html: '<p>Exists</p>' });
		const options = await getAuthOptions();
		const unverified = { email: 'pending@example.com', name: 'Pending', emailVerified: false };
		const verified = { email: 'known@example.com', name: 'Known', emailVerified: true };

		const signUpRequest = new Request('https://nao.test/api/auth/sign-up/email', {
			method: 'POST',
			body: JSON.stringify({ callbackURL: '/email-verified?redirect=%2Fsettings' }),
		});
		await options.emailAndPassword.onExistingUserSignUp({ user: unverified }, signUpRequest);
		await options.emailAndPassword.onExistingUserSignUp({ user: verified });
		await options.hooks.after({
			path: '/send-verification-email',
			body: { email: verified.email },
			context: {
				returned: { status: true },
				internalAdapter: { findUserByEmail: async () => ({ user: verified }) },
			},
		});

		expect(sendVerificationEmail).toHaveBeenCalledExactlyOnceWith({
			body: { email: 'pending@example.com', callbackURL: '/email-verified?redirect=%2Fsettings' },
		});
		expect(mocks.emailSend).toHaveBeenCalledTimes(2);
		expect(mocks.emailSend).toHaveBeenCalledWith('known@example.com', { subject: 'Exists', html: '<p>Exists</p>' });
	});

	it('leaves self-hosted email authentication unchanged', async () => {
		mocks.env.NAO_MODE = 'self-hosted';

		const options = await getAuthOptions();

		expect(options.emailAndPassword.requireEmailVerification).toBe(false);
		expect(options.emailVerification).toBeUndefined();
		expect(options.rateLimit).toBeUndefined();

		await options.databaseHooks.user.create.after(
			{ id: 'self-hosted-user', email: 'user@example.com' },
			{ params: { id: 'credential' } },
		);
		expect(mocks.enqueueOnce).not.toHaveBeenCalled();
	});
});

async function getAuthOptions(): Promise<CapturedAuthOptions> {
	updateAuth();
	await getAuth();
	return mocks.betterAuth.mock.calls.at(-1)?.[0] as CapturedAuthOptions;
}
