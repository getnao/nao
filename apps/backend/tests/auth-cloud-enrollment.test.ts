import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addOrgMemberIfMissing: vi.fn(),
	betterAuth: vi.fn(),
	findOrganizationByEmailDomain: vi.fn(),
	recordOrganizationJoinCandidate: vi.fn(),
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
	env: {
		BETTER_AUTH_SECRET: 'test-secret-at-least-twenty-characters',
		DEFAULT_USER_ROLE: 'user',
		ENABLE_USER_LOGIN: true,
		ENABLE_USER_SIGNUP: true,
		GOOGLE_CLIENT_ID: 'google-client',
		GOOGLE_CLIENT_SECRET: 'google-secret',
		MODE: 'test',
	},
	isCloud: true,
	MCP_VALID_AUDIENCES: [],
}));
vi.mock('../src/queries/organization.queries', () => ({
	addOrgMemberIfMissing: mocks.addOrgMemberIfMissing,
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
	recordOrganizationJoinCandidate: mocks.recordOrganizationJoinCandidate,
}));
vi.mock('../src/services/email', () => ({ emailService: { sendEmail: vi.fn() } }));
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
vi.mock('../src/services/oidc-auth.service', () => ({
	augmentPluginsWithOidc: vi.fn(),
	getOidcProviderId: vi.fn(() => 'oidc'),
	getTrustedProvidersForOidc: vi.fn(() => []),
}));
vi.mock('../src/services/sso-login-sync.service', () => ({ syncSsoLoginGroups: vi.fn() }));
vi.mock('../src/services/sso-session.service', () => ({ shouldExpireSsoSession: vi.fn() }));
vi.mock('../src/utils/email-builders', () => ({ buildForgotPasswordEmail: vi.fn() }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
	serializeError: vi.fn(),
}));

import { getAuth, updateAuth } from '../src/auth';

describe('Cloud Google organization enrollment', () => {
	beforeEach(() => {
		updateAuth();
		mocks.addOrgMemberIfMissing.mockReset();
		mocks.betterAuth.mockReset().mockReturnValue({});
		mocks.findOrganizationByEmailDomain.mockReset().mockResolvedValue({ id: 'matched-org' });
		mocks.recordOrganizationJoinCandidate.mockReset();
	});

	it('records a join grant candidate for the matched organization', async () => {
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
		expect(mocks.recordOrganizationJoinCandidate).toHaveBeenCalledWith('matched-org', 'google-user');
	});
});
