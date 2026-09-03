import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};
let mockSsoEnabled = true;
const mockGetGoogleConfig = vi.fn();
const mockGetUserRoleInProject = vi.fn();
const mockInspectSsoToken = vi.fn();

vi.mock('../src/env', () => ({
	get env() {
		return mockEnv;
	},
	get isCloud() {
		return mockEnv.NAO_MODE === 'cloud';
	},
}));

vi.mock('../src/auth', () => ({
	updateAuth: vi.fn(),
}));

vi.mock('../src/queries/organization.queries', () => ({
	getFirstOrganization: vi.fn().mockResolvedValue(null),
	getGoogleConfig: mockGetGoogleConfig,
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mockGetUserRoleInProject,
}));

vi.mock('../src/services/email', () => ({
	emailService: { isEnabled: () => false },
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn().mockImplementation(() => Promise.resolve(mockSsoEnabled)),
	LICENSE_FEATURES: { sso: 'sso' },
}));

vi.mock('../src/services/sso-group-mapping.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/sso-group-mapping.service')>()),
	inspectSsoToken: mockInspectSsoToken,
}));

vi.mock('../src/db/db', () => ({ db: {} }));

describe('authConfigRoutes.oidc.getConfig', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
		mockSsoEnabled = true;
		mockGetGoogleConfig.mockReset();
		mockGetGoogleConfig.mockResolvedValue({
			clientId: '',
			clientSecret: '',
			authDomains: '',
		});
	});

	it('returns null when OIDC_CLIENT_ID is missing', async () => {
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns null when OIDC_CLIENT_SECRET is missing', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns null when OIDC_DISCOVERY_URL is missing', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns config with defaults when all required vars are set', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';

		const result = await callGetConfig();
		expect(result).toEqual({
			providerId: 'oidc',
			providerName: 'SSO',
			rolesManagedByIdp: false,
		});
	});

	it('returns null when SSO license feature is not enabled', async () => {
		mockSsoEnabled = false;
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns custom provider ID and name when set', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://dev-test.okta.com/oauth2/default/.well-known/openid-configuration';
		mockEnv.OIDC_PROVIDER_ID = 'okta';
		mockEnv.OIDC_PROVIDER_NAME = 'Okta';

		const result = await callGetConfig();
		expect(result).toEqual({
			providerId: 'okta',
			providerName: 'Okta',
			rolesManagedByIdp: false,
		});
	});

	it('reports roles as IdP-managed when a group mapping is configured', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
		mockEnv.OIDC_GROUP_ROLE_MAPPING = 'nao-admins:admin';

		await expect(callGetConfig()).resolves.toMatchObject({ rolesManagedByIdp: true });
	});

	it('reports roles as editable when the group mapping has no usable entry', async () => {
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
		mockEnv.OIDC_GROUP_ROLE_MAPPING = 'nao-admins:superuser';

		await expect(callGetConfig()).resolves.toMatchObject({ rolesManagedByIdp: false });
	});
});

describe('authConfigRoutes.oidc.inspectToken', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
		mockEnv.OIDC_CLIENT_ID = 'client-id';
		mockEnv.OIDC_CLIENT_SECRET = 'secret';
		mockEnv.OIDC_DISCOVERY_URL = 'https://example.com/.well-known/openid-configuration';
		mockSsoEnabled = true;
		mockGetUserRoleInProject.mockReset();
		mockInspectSsoToken.mockReset();
		mockInspectSsoToken.mockResolvedValue({ problem: null });
	});

	it('rejects inspection for a user outside the project', async () => {
		mockGetUserRoleInProject.mockResolvedValue(null);

		await expect(callInspectToken('outside-user')).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mockGetUserRoleInProject).toHaveBeenCalledWith('project-id', 'outside-user');
		expect(mockInspectSsoToken).not.toHaveBeenCalled();
	});

	it('allows inspection for another project member', async () => {
		mockGetUserRoleInProject.mockResolvedValue('viewer');

		await expect(callInspectToken('project-member')).resolves.toEqual({ problem: null });
		expect(mockGetUserRoleInProject).toHaveBeenCalledWith('project-id', 'project-member');
		expect(mockInspectSsoToken).toHaveBeenCalledWith('project-member');
	});
});

describe('authConfigRoutes.google.isSetup', () => {
	beforeEach(() => {
		Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
		mockEnv.BETTER_AUTH_URL = 'https://nao.cloud';
		mockGetGoogleConfig.mockReset();
		mockGetGoogleConfig.mockResolvedValue({
			clientId: 'org-client',
			clientSecret: 'org-secret',
			authDomains: '',
		});
	});

	it('exposes Google SSO in cloud when deployment credentials are set', async () => {
		mockEnv.NAO_MODE = 'cloud';
		mockEnv.GOOGLE_CLIENT_ID = 'deployment-client';
		mockEnv.GOOGLE_CLIENT_SECRET = 'deployment-secret';

		await expect(callGoogleIsSetup()).resolves.toBe(true);
		expect(mockGetGoogleConfig).not.toHaveBeenCalled();
	});

	it('hides Google SSO in cloud when deployment credentials are missing', async () => {
		mockEnv.NAO_MODE = 'cloud';

		await expect(callGoogleIsSetup()).resolves.toBe(false);
		expect(mockGetGoogleConfig).not.toHaveBeenCalled();
	});

	it('uses the org Google config in self-hosted mode', async () => {
		mockEnv.NAO_MODE = 'self-hosted';

		await expect(callGoogleIsSetup()).resolves.toBe(true);
		expect(mockGetGoogleConfig).toHaveBeenCalled();
	});
});

async function callGetConfig() {
	vi.resetModules();
	const { authConfigRoutes } = await import('../src/trpc/auth-config.routes');
	const procedure = authConfigRoutes.oidc.getConfig;
	// The procedure is a tRPC query — extract the resolver function
	// @ts-expect-error accessing internal tRPC structure for testing
	const resolver = procedure._def.query ?? procedure._def.resolver;
	if (resolver) {
		return resolver({ ctx: {}, input: undefined });
	}
	// Fallback: try calling directly if the structure differs
	return null;
}

async function callInspectToken(userId: string) {
	vi.resetModules();
	const { authConfigRoutes } = await import('../src/trpc/auth-config.routes');
	const procedure = authConfigRoutes.oidc.inspectToken;
	// @ts-expect-error accessing internal tRPC structure for testing
	const resolver = procedure._def.query ?? procedure._def.resolver;
	return resolver({
		ctx: { project: { id: 'project-id' }, user: { id: 'current-user' } },
		input: { userId },
	});
}

async function callGoogleIsSetup() {
	vi.resetModules();
	const { authConfigRoutes } = await import('../src/trpc/auth-config.routes');
	const procedure = authConfigRoutes.google.isSetup;
	// @ts-expect-error accessing internal tRPC structure for testing
	const resolver = procedure._def.query ?? procedure._def.resolver;
	if (resolver) {
		return resolver({ ctx: {}, input: undefined });
	}
	return null;
}
