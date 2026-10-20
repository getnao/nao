import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { authConfigRoutes } from '../../src/trpc/auth-config.routes';

type AuthConfigRoutes = typeof authConfigRoutes;

const mockEnv: Record<string, unknown> = {};
let mockSsoEnabled = true;
const mockGetGoogleConfig = vi.fn();
const mockGetUserRoleInProject = vi.fn();
const mockInspectSsoToken = vi.fn();
const mockIsUserConfinedToOrganization = vi.fn();

vi.mock('../../src/env', () => ({
	get env() {
		return mockEnv;
	},
	get isCloud() {
		return mockEnv.NAO_MODE === 'cloud';
	},
}));

vi.mock('../../src/auth', () => ({
	updateAuth: vi.fn(),
}));

vi.mock('../../src/queries/organization.queries', () => ({
	getFirstOrganization: vi.fn().mockResolvedValue(null),
	getGoogleConfig: mockGetGoogleConfig,
}));

vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mockGetUserRoleInProject,
}));

vi.mock('../../src/queries/user.queries', () => ({
	isUserConfinedToOrganization: mockIsUserConfinedToOrganization,
}));

vi.mock('../../src/services/email', () => ({
	emailService: { isEnabled: () => false },
}));

vi.mock('../../src/services/license.service', () => ({
	hasFeature: vi.fn().mockImplementation(() => Promise.resolve(mockSsoEnabled)),
	LICENSE_FEATURES: { sso: 'sso' },
}));

vi.mock('../../src/services/sso-group-mapping.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/sso-group-mapping.service')>()),
	inspectSsoToken: mockInspectSsoToken,
}));

vi.mock('../../src/db/db', () => ({ db: {} }));

const OIDC_ENV = {
	OIDC_CLIENT_ID: 'client-id',
	OIDC_CLIENT_SECRET: 'secret',
	OIDC_DISCOVERY_URL: 'https://example.com/.well-known/openid-configuration',
};
const ENTRA_ROLE_MAPPING_ENV = {
	AZURE_AD_CLIENT_ID: 'client-id',
	AZURE_AD_CLIENT_SECRET: 'secret',
	AZURE_AD_TENANT_ID: 'tenant-id',
	AZURE_AD_GROUP_NAO_ROLE_MAPPING: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin',
};

describe('authConfigRoutes.oidc.getConfig', () => {
	beforeEach(() => {
		resetEnv();
		mockSsoEnabled = true;
		mockGetGoogleConfig.mockReset();
		mockGetGoogleConfig.mockResolvedValue({
			clientId: '',
			clientSecret: '',
			authDomains: '',
		});
	});

	it.each(Object.keys(OIDC_ENV))('returns null when %s is missing', async (missingKey) => {
		resetEnv({ ...OIDC_ENV, [missingKey]: undefined });

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns config with defaults when all required vars are set', async () => {
		resetEnv(OIDC_ENV);

		const result = await callGetConfig();
		expect(result).toEqual({
			providerId: 'oidc',
			providerName: 'SSO',
			organizationRolesManagedByIdp: false,
		});
	});

	it('returns null when SSO license feature is not enabled', async () => {
		mockSsoEnabled = false;
		resetEnv(OIDC_ENV);

		const result = await callGetConfig();
		expect(result).toBeNull();
	});

	it('returns custom provider ID and name when set', async () => {
		resetEnv({
			...OIDC_ENV,
			OIDC_DISCOVERY_URL: 'https://dev-test.okta.com/oauth2/default/.well-known/openid-configuration',
			OIDC_PROVIDER_ID: 'okta',
			OIDC_PROVIDER_NAME: 'Okta',
		});

		const result = await callGetConfig();
		expect(result).toEqual({
			providerId: 'okta',
			providerName: 'Okta',
			organizationRolesManagedByIdp: false,
		});
	});

	it('reports roles as IdP-managed when a group mapping is configured', async () => {
		resetEnv({ ...OIDC_ENV, OIDC_GROUP_NAO_ROLE_MAPPING: 'nao-admins:admin' });

		await expect(callGetConfig()).resolves.toMatchObject({ organizationRolesManagedByIdp: true });
	});

	it('reports roles as editable when the group mapping has no usable entry', async () => {
		resetEnv({ ...OIDC_ENV, OIDC_GROUP_NAO_ROLE_MAPPING: 'nao-context:context_admin,nao-admins:superuser' });

		await expect(callGetConfig()).resolves.toMatchObject({ organizationRolesManagedByIdp: false });
	});
});

describe('authConfigRoutes.sso.getStatus', () => {
	beforeEach(() => {
		resetEnv();
		mockSsoEnabled = true;
	});

	it('reports Entra-managed organization roles only when configured and licensed', async () => {
		resetEnv(ENTRA_ROLE_MAPPING_ENV);

		await expect(callSsoStatus()).resolves.toEqual({
			organizationRolesManagedByIdp: true,
			providerName: 'Microsoft Entra',
		});

		mockSsoEnabled = false;
		await expect(callSsoStatus()).resolves.toMatchObject({ organizationRolesManagedByIdp: false });
	});

	it('uses a neutral provider name when OIDC and Entra role mappings are active', async () => {
		resetEnv({
			...OIDC_ENV,
			OIDC_PROVIDER_NAME: 'Okta',
			OIDC_GROUP_NAO_ROLE_MAPPING: 'nao-admins:admin',
			...ENTRA_ROLE_MAPPING_ENV,
		});

		await expect(callSsoStatus()).resolves.toEqual({
			organizationRolesManagedByIdp: true,
			providerName: 'SSO',
		});
	});

	it('does not activate Entra role mapping without the Microsoft provider', async () => {
		resetEnv({ AZURE_AD_GROUP_NAO_ROLE_MAPPING: ENTRA_ROLE_MAPPING_ENV.AZURE_AD_GROUP_NAO_ROLE_MAPPING });
		await expect(callSsoStatus()).resolves.toMatchObject({ organizationRolesManagedByIdp: false });
	});
});

describe('authConfigRoutes.oidc.inspectToken', () => {
	beforeEach(() => {
		resetEnv(OIDC_ENV);
		mockSsoEnabled = true;
		mockGetUserRoleInProject.mockReset();
		mockInspectSsoToken.mockReset();
		mockInspectSsoToken.mockResolvedValue({ problem: null });
		mockIsUserConfinedToOrganization.mockReset();
		mockIsUserConfinedToOrganization.mockResolvedValue(true);
	});

	it('rejects inspection of a member who also belongs to another organization', async () => {
		mockGetUserRoleInProject.mockResolvedValue('user');
		mockIsUserConfinedToOrganization.mockResolvedValue(false);

		await expect(callInspectToken('pulled-in-user')).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mockIsUserConfinedToOrganization).toHaveBeenCalledWith('pulled-in-user', 'org-id');
		expect(mockInspectSsoToken).not.toHaveBeenCalled();
	});

	it('lets a user inspect their own token whatever else they belong to', async () => {
		mockIsUserConfinedToOrganization.mockResolvedValue(false);

		await expect(callInspectToken('current-user')).resolves.toEqual({ problem: null });
		expect(mockInspectSsoToken).toHaveBeenCalledWith('current-user');
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
		resetEnv({ BETTER_AUTH_URL: 'https://nao.cloud' });
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

function callGetConfig() {
	return callResolver((routes) => routes.oidc.getConfig);
}

function callInspectToken(userId: string) {
	return callResolver((routes) => routes.oidc.inspectToken, {
		ctx: { project: { id: 'project-id', orgId: 'org-id' }, user: { id: 'current-user' } },
		input: { userId },
	});
}

function callSsoStatus() {
	return callResolver((routes) => routes.sso.getStatus);
}

function callGoogleIsSetup() {
	return callResolver((routes) => routes.google.isSetup);
}

/** Re-imports the routes so module-level env reads see the current `mockEnv`, then runs the raw resolver. */
async function callResolver(
	selectProcedure: (routes: AuthConfigRoutes) => unknown,
	options: { ctx: unknown; input: unknown } = { ctx: {}, input: undefined },
) {
	vi.resetModules();
	const { authConfigRoutes } = await import('../../src/trpc/auth-config.routes');
	const procedure = selectProcedure(authConfigRoutes) as {
		_def: { resolver: (options: { ctx: unknown; input: unknown }) => Promise<unknown> };
	};
	return procedure._def.resolver(options);
}

function resetEnv(values: Record<string, unknown> = {}) {
	Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
	Object.assign(mockEnv, values);
}
