import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	readDecodedClaims: vi.fn(),
	readVerifiedClaims: vi.fn(),
	getUserOrgMembership: vi.fn(),
	updateOrgMemberRole: vi.fn(),
	countOrgAdmins: vi.fn(),
	updateProjectMemberRole: vi.fn(),
	cleanupContextWorktree: vi.fn(),
	hasFeature: vi.fn(),
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../src/env', () => ({
	env: mocks.env,
}));

vi.mock('../src/services/sso-token.service', () => ({
	readDecodedIdTokenClaims: mocks.readDecodedClaims,
	readVerifiedOidcIdTokenClaims: mocks.readVerifiedClaims,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
	updateOrgMemberRole: mocks.updateOrgMemberRole,
	countOrgAdmins: mocks.countOrgAdmins,
}));

vi.mock('../src/queries/project.queries', () => ({
	updateProjectMemberRole: mocks.updateProjectMemberRole,
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));

vi.mock('../src/services/microsoft-auth.service', () => ({
	isMicrosoftConfigured: () =>
		!!(mocks.env.AZURE_AD_CLIENT_ID && mocks.env.AZURE_AD_CLIENT_SECRET && mocks.env.AZURE_AD_TENANT_ID),
}));

vi.mock('../src/services/context-explorer-git.service', () => ({
	cleanupContextWorktree: mocks.cleanupContextWorktree,
}));

vi.mock('../src/utils/logger', () => ({
	logger: mocks.logger,
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));

import {
	inspectSsoToken,
	isOrganizationRoleMappingActive,
	syncOrganizationRoleFromMicrosoftGroups,
	syncOrganizationRoleFromSsoGroups,
} from '../src/services/sso-group-mapping.service';
import {
	decideGroupOrganizationRoleMapping,
	extractGroups,
	parseEntraGroupNaoGroupMapping,
	parseEntraGroupOrganizationRoleMapping,
	parseGroupOrganizationRoleMapping,
	parseOidcGroupNaoGroupMapping,
	resolveEntraGroupNaoGroupMappingTargets,
	resolveOidcGroupNaoGroupMappings,
	resolveOrganizationRoleFromGroups,
} from '../src/utils/sso-group-mapping';
import { hasSsoSessionExceededMaxAge } from '../src/utils/sso-session';

beforeEach(() => {
	for (const key of Object.keys(mocks.env)) {
		delete mocks.env[key];
	}
	Object.assign(mocks.env, {
		OIDC_CLIENT_ID: 'client-id',
		OIDC_CLIENT_SECRET: 'client-secret',
		OIDC_DISCOVERY_URL: 'https://example.com/.well-known/openid-configuration',
		OIDC_GROUP_NAO_ROLE_MAPPING: 'nao-viewers:viewer',
	});

	mocks.readVerifiedClaims.mockReset();
	mocks.readDecodedClaims.mockReset();
	mocks.getUserOrgMembership.mockReset().mockResolvedValue({ orgId: 'org-1', role: 'viewer' });
	mocks.updateOrgMemberRole.mockReset().mockResolvedValue(undefined);
	mocks.countOrgAdmins.mockReset().mockResolvedValue(2);
	mocks.updateProjectMemberRole.mockReset().mockResolvedValue(undefined);
	mocks.cleanupContextWorktree.mockReset().mockResolvedValue(undefined);
	mocks.hasFeature.mockReset().mockResolvedValue(true);
	for (const method of Object.values(mocks.logger)) {
		method.mockReset();
	}
});

describe('inspectSsoToken', () => {
	it('reports the resolved organization role with organization-scoped mapping fields', async () => {
		mocks.env.OIDC_GROUP_NAO_ROLE_MAPPING = 'nao-admins:admin,nao-context:context_admin';
		mocks.readDecodedClaims.mockResolvedValue({
			status: 'decoded',
			claims: { groups: ['nao-admins', 'nao-context'] },
		});

		await expect(inspectSsoToken('user-1')).resolves.toMatchObject({
			resolvedOrganizationRole: 'admin',
			mapping: [{ group: 'nao-admins', organizationRole: 'admin' }],
		});
	});
});

describe('isOrganizationRoleMappingActive', () => {
	it('returns false when a mapping exists but OIDC is not configured', async () => {
		delete mocks.env.OIDC_CLIENT_ID;
		delete mocks.env.OIDC_CLIENT_SECRET;
		delete mocks.env.OIDC_DISCOVERY_URL;

		await expect(isOrganizationRoleMappingActive()).resolves.toBe(false);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns true when OIDC, the mapping, and the SSO feature are configured', async () => {
		await expect(isOrganizationRoleMappingActive()).resolves.toBe(true);
	});

	it('returns false when every configured role is invalid for an organization', async () => {
		mocks.env.OIDC_GROUP_NAO_ROLE_MAPPING = 'nao-context:context_admin,nao-other:superuser';

		await expect(isOrganizationRoleMappingActive()).resolves.toBe(false);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns true for a licensed configured Microsoft Entra role mapping', async () => {
		delete mocks.env.OIDC_GROUP_NAO_ROLE_MAPPING;
		Object.assign(mocks.env, {
			AZURE_AD_CLIENT_ID: 'client-id',
			AZURE_AD_CLIENT_SECRET: 'client-secret',
			AZURE_AD_TENANT_ID: 'tenant-id',
			AZURE_AD_GROUP_NAO_ROLE_MAPPING: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin',
		});

		await expect(isOrganizationRoleMappingActive()).resolves.toBe(true);
	});
});

describe('syncOrganizationRoleFromSsoGroups', () => {
	it('does not apply roles from an invalid ID token', async () => {
		mocks.readVerifiedClaims.mockResolvedValue({ status: 'invalid' });

		await syncOrganizationRoleFromSsoGroups('user-1');

		expect(mocks.updateOrgMemberRole).not.toHaveBeenCalled();
		expect(mocks.logger.warn).toHaveBeenCalledWith('Could not verify the SSO ID token, leaving roles untouched', {
			source: 'system',
			context: { userId: 'user-1', problem: 'invalid' },
		});
	});

	it('updates only the organization role', async () => {
		mocks.getUserOrgMembership.mockResolvedValue({ orgId: 'org-1', role: 'user' });
		mocks.readVerifiedClaims.mockResolvedValue({ status: 'verified', claims: { groups: ['nao-viewers'] } });

		await syncOrganizationRoleFromSsoGroups('user-1');

		expect(mocks.updateOrgMemberRole).toHaveBeenCalledWith('org-1', 'user-1', 'viewer');
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
		expect(mocks.cleanupContextWorktree).not.toHaveBeenCalled();
	});

	it('does nothing when the user has no organization membership', async () => {
		mocks.getUserOrgMembership.mockResolvedValue(null);
		mocks.readVerifiedClaims.mockResolvedValue({ status: 'verified', claims: { groups: ['nao-viewers'] } });

		await syncOrganizationRoleFromSsoGroups('user-1');

		expect(mocks.updateOrgMemberRole).not.toHaveBeenCalled();
	});

	it('does not demote the last organization admin', async () => {
		mocks.getUserOrgMembership.mockResolvedValue({ orgId: 'org-1', role: 'admin' });
		mocks.countOrgAdmins.mockResolvedValue(1);
		mocks.readVerifiedClaims.mockResolvedValue({ status: 'verified', claims: { groups: ['nao-viewers'] } });

		await syncOrganizationRoleFromSsoGroups('user-1');

		expect(mocks.updateOrgMemberRole).not.toHaveBeenCalled();
		expect(mocks.logger.warn).toHaveBeenCalledWith('Skipped SSO group demotion of the last organization admin', {
			source: 'system',
			context: { orgId: 'org-1', nextRole: 'viewer' },
		});
	});
});

describe('syncOrganizationRoleFromMicrosoftGroups', () => {
	beforeEach(() => {
		Object.assign(mocks.env, {
			AZURE_AD_CLIENT_ID: 'client-id',
			AZURE_AD_CLIENT_SECRET: 'client-secret',
			AZURE_AD_TENANT_ID: 'tenant-id',
			AZURE_AD_GROUP_NAO_ROLE_MAPPING:
				'a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer,11111111-2222-3333-4444-555555555555:admin',
		});
	});

	it('applies the strongest direct Entra group role without changing project roles', async () => {
		await syncOrganizationRoleFromMicrosoftGroups('user-1', [
			'a0b1c2d3-e4f5-6789-abcd-ef0123456789',
			'11111111-2222-3333-4444-555555555555',
		]);

		expect(mocks.updateOrgMemberRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
	});

	it('leaves the organization role untouched when no mapped Object ID matches', async () => {
		await syncOrganizationRoleFromMicrosoftGroups('user-1', ['22222222-3333-4444-5555-666666666666']);
		expect(mocks.updateOrgMemberRole).not.toHaveBeenCalled();
	});
});

describe('parseGroupOrganizationRoleMapping', () => {
	it('parses a comma-separated list of group:role pairs', () => {
		const mapping = parseGroupOrganizationRoleMapping('nao-admins:admin,nao-viewers:viewer');
		expect(mapping.get('nao-admins')).toBe('admin');
		expect(mapping.get('nao-viewers')).toBe('viewer');
	});

	it('lowercases group names so claim casing does not matter', () => {
		expect(parseGroupOrganizationRoleMapping('NAO-Admins:admin').get('nao-admins')).toBe('admin');
	});

	it('trims whitespace around entries', () => {
		expect(parseGroupOrganizationRoleMapping(' nao-admins : admin , nao-users : user ').get('nao-users')).toBe(
			'user',
		);
	});

	it('drops context_admin because it is project-only', () => {
		expect(parseGroupOrganizationRoleMapping('nao-context:context_admin').has('nao-context')).toBe(false);
	});

	it('keeps colons that belong to the group name', () => {
		expect(parseGroupOrganizationRoleMapping('okta:group:admins:admin').get('okta:group:admins')).toBe('admin');
	});

	it('drops entries with an unknown role rather than failing', () => {
		const mapping = parseGroupOrganizationRoleMapping('nao-admins:superuser,nao-users:user');
		expect(mapping.has('nao-admins')).toBe(false);
		expect(mapping.get('nao-users')).toBe('user');
	});

	it('drops entries without a separator', () => {
		expect(parseGroupOrganizationRoleMapping('nao-admins').size).toBe(0);
	});

	it('returns an empty mapping when unset', () => {
		expect(parseGroupOrganizationRoleMapping(undefined).size).toBe(0);
		expect(parseGroupOrganizationRoleMapping('').size).toBe(0);
	});
});

describe('OIDC to nao User Group mapping', () => {
	it('normalizes names and resolves exact project scopes before wildcards', () => {
		const parsed = parseOidcGroupNaoGroupMapping(
			' Finance-Team : * : Analysts , finance-team : project-1 : Project Analysts ',
		);
		expect(parsed.status).toBe('valid');
		if (parsed.status !== 'valid') {
			return;
		}

		expect(resolveOidcGroupNaoGroupMappings([' FINANCE-TEAM '], 'project-1', parsed.mappings)).toEqual(
			new Map([['finance-team', 'project analysts']]),
		);
		expect(resolveOidcGroupNaoGroupMappings(['finance-team'], 'project-2', parsed.mappings)).toEqual(
			new Map([['finance-team', 'analysts']]),
		);
	});

	it.each([
		'finance-team',
		'finance-team:*',
		'finance-team:*:Analysts:Extra',
		':*:Analysts',
		'finance-team::Analysts',
		'finance-team:*:',
	])('rejects malformed entry %s', (raw) => {
		expect(parseOidcGroupNaoGroupMapping(raw).status).toBe('invalid');
	});

	it('deduplicates identical entries and rejects conflicting repeats', () => {
		expect(parseOidcGroupNaoGroupMapping('finance:*:Analysts,FINANCE:*:analysts')).toMatchObject({
			status: 'valid',
			mappings: [{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'analysts' }],
		});
		expect(parseOidcGroupNaoGroupMapping('finance:*:Analysts,finance:*:Managers').status).toBe('invalid');
	});
});

describe('Microsoft Entra environment mappings', () => {
	const groupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';

	it('normalizes Object IDs and gives exact projects precedence over wildcards', () => {
		const parsed = parseEntraGroupNaoGroupMapping(
			`${groupId.toUpperCase()}:*:Analysts,${groupId}:project-1:Managers`,
		);
		expect(parsed.status).toBe('valid');
		if (parsed.status !== 'valid') {
			return;
		}
		expect(
			resolveEntraGroupNaoGroupMappingTargets('project-1', parsed.mappings, [
				{ id: 'analysts', name: 'ANALYSTS' },
				{ id: 'managers', name: 'Managers' },
			]),
		).toEqual(new Map([[groupId, { id: 'managers', name: 'Managers' }]]));
	});

	it('rejects malformed IDs and conflicting duplicate targets', () => {
		expect(parseEntraGroupNaoGroupMapping('not-a-guid:*:Analysts').status).toBe('invalid');
		expect(parseEntraGroupNaoGroupMapping(`${groupId}:*:Analysts,${groupId}:*:Managers`).status).toBe('invalid');
	});

	it('accepts organization roles only and resolves conflicting duplicates safely', () => {
		expect(parseEntraGroupOrganizationRoleMapping(`${groupId}:admin`)).toMatchObject({
			status: 'valid',
			mapping: new Map([[groupId, 'admin']]),
		});
		expect(parseEntraGroupOrganizationRoleMapping(`${groupId}:context_admin`).status).toBe('invalid');
		expect(parseEntraGroupOrganizationRoleMapping(`${groupId}:admin,${groupId}:viewer`).status).toBe('invalid');
	});
});

describe('resolveOrganizationRoleFromGroups', () => {
	const mapping = parseGroupOrganizationRoleMapping('nao-admins:admin,nao-users:user,nao-viewers:viewer');

	it('resolves a single matching group', () => {
		expect(resolveOrganizationRoleFromGroups(['nao-users'], mapping)).toBe('user');
	});

	it('picks the most privileged role when several groups match', () => {
		expect(resolveOrganizationRoleFromGroups(['nao-viewers', 'nao-admins', 'nao-users'], mapping)).toBe('admin');
	});

	it('ignores groups that are not mapped', () => {
		expect(resolveOrganizationRoleFromGroups(['everyone', 'nao-viewers'], mapping)).toBe('viewer');
	});

	it('is case-insensitive on group names', () => {
		expect(resolveOrganizationRoleFromGroups(['NAO-Admins'], mapping)).toBe('admin');
	});

	it('returns null when no group matches', () => {
		expect(resolveOrganizationRoleFromGroups(['everyone'], mapping)).toBeNull();
		expect(resolveOrganizationRoleFromGroups([], mapping)).toBeNull();
	});
});

describe('decideGroupOrganizationRoleMapping', () => {
	const mapping = parseGroupOrganizationRoleMapping('nao-admins:admin,nao-users:user');

	it('allows access and returns the resolved role when a group matches', () => {
		expect(decideGroupOrganizationRoleMapping({ groups: ['nao-users'] }, 'groups', mapping)).toEqual({
			action: 'allow',
			organizationRole: 'user',
			claimPresent: true,
		});
	});

	it('denies access when the claim is present but no group matches', () => {
		expect(decideGroupOrganizationRoleMapping({ groups: ['everyone'] }, 'groups', mapping)).toEqual({
			action: 'deny',
			organizationRole: null,
			claimPresent: true,
		});
		expect(decideGroupOrganizationRoleMapping({ groups: [] }, 'groups', mapping).action).toBe('deny');
	});

	it('denies access when the claim is present in an unsupported format', () => {
		expect(decideGroupOrganizationRoleMapping({ groups: 42 }, 'groups', mapping).action).toBe('deny');
	});

	it('allows access without a role when the claim is missing', () => {
		expect(decideGroupOrganizationRoleMapping({}, 'groups', mapping)).toEqual({
			action: 'allow',
			organizationRole: null,
			claimPresent: false,
		});
	});

	it('allows access without a role when claims could not be decoded', () => {
		expect(decideGroupOrganizationRoleMapping(null, 'groups', mapping)).toEqual({
			action: 'allow',
			organizationRole: null,
			claimPresent: false,
		});
	});
});

describe('extractGroups', () => {
	it('reads an array claim', () => {
		expect(extractGroups({ groups: ['a', 'b'] }, 'groups')).toEqual(['a', 'b']);
	});

	it('reads a comma-separated string claim', () => {
		expect(extractGroups({ groups: 'a, b' }, 'groups')).toEqual(['a', 'b']);
	});

	it('reads a custom claim name', () => {
		expect(extractGroups({ 'nao/roles': ['a'] }, 'nao/roles')).toEqual(['a']);
	});

	it('drops non-string entries from an array claim', () => {
		expect(extractGroups({ groups: ['a', 42, null] }, 'groups')).toEqual(['a']);
	});

	it('returns an empty list when the claim is missing or not a group list', () => {
		expect(extractGroups({}, 'groups')).toEqual([]);
		expect(extractGroups({ groups: 42 }, 'groups')).toEqual([]);
	});
});

describe('hasSsoSessionExceededMaxAge', () => {
	const createdAt = new Date('2026-08-12T10:00:00.000Z');

	it('keeps a session before the maximum age', () => {
		expect(hasSsoSessionExceededMaxAge(createdAt, 3600, new Date('2026-08-12T10:59:59.999Z'))).toBe(false);
	});

	it('expires a session at the maximum age boundary', () => {
		expect(hasSsoSessionExceededMaxAge(createdAt, 3600, new Date('2026-08-12T11:00:00.000Z'))).toBe(true);
	});

	it('expires a session after the maximum age', () => {
		expect(hasSsoSessionExceededMaxAge(createdAt, 3600, new Date('2026-08-12T12:00:00.000Z'))).toBe(true);
	});
});
