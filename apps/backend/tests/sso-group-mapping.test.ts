import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	getIdToken: vi.fn(),
	getUserOrgMembership: vi.fn(),
	updateOrgMemberRole: vi.fn(),
	countOrgAdmins: vi.fn(),
	listProjectMembershipsForUser: vi.fn(),
	updateProjectMemberRole: vi.fn(),
	checkProjectHasMoreThanOneAdmin: vi.fn(),
	hasFeature: vi.fn(),
	cleanupContextWorktree: vi.fn(),
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

vi.mock('../src/queries/account.queries', () => ({
	getIdToken: mocks.getIdToken,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
	updateOrgMemberRole: mocks.updateOrgMemberRole,
	countOrgAdmins: mocks.countOrgAdmins,
}));

vi.mock('../src/queries/project.queries', () => ({
	listProjectMembershipsForUser: mocks.listProjectMembershipsForUser,
	updateProjectMemberRole: mocks.updateProjectMemberRole,
	checkProjectHasMoreThanOneAdmin: mocks.checkProjectHasMoreThanOneAdmin,
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
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

import { isGroupRoleMappingActive, syncRolesFromSsoGroups } from '../src/services/sso-group-mapping.service';
import {
	decideGroupRoleMapping,
	extractGroups,
	parseGroupRoleMapping,
	resolveRoleFromGroups,
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
		OIDC_GROUP_ROLE_MAPPING: 'nao-viewers:viewer',
	});

	mocks.getIdToken.mockReset();
	mocks.getUserOrgMembership.mockReset().mockResolvedValue({ orgId: 'org-1', role: 'viewer' });
	mocks.updateOrgMemberRole.mockReset().mockResolvedValue(undefined);
	mocks.countOrgAdmins.mockReset().mockResolvedValue(2);
	mocks.listProjectMembershipsForUser.mockReset().mockResolvedValue([]);
	mocks.updateProjectMemberRole.mockReset().mockResolvedValue(undefined);
	mocks.checkProjectHasMoreThanOneAdmin.mockReset().mockResolvedValue(true);
	mocks.hasFeature.mockReset().mockResolvedValue(true);
	mocks.cleanupContextWorktree.mockReset().mockResolvedValue(undefined);
	for (const method of Object.values(mocks.logger)) {
		method.mockReset();
	}
});

describe('isGroupRoleMappingActive', () => {
	it('returns false when a mapping exists but OIDC is not configured', async () => {
		delete mocks.env.OIDC_CLIENT_ID;
		delete mocks.env.OIDC_CLIENT_SECRET;
		delete mocks.env.OIDC_DISCOVERY_URL;

		await expect(isGroupRoleMappingActive()).resolves.toBe(false);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns true when OIDC, the mapping, and the SSO feature are configured', async () => {
		await expect(isGroupRoleMappingActive()).resolves.toBe(true);
	});
});

describe('syncRolesFromSsoGroups', () => {
	it('cleans up context worktrees after project admin demotions', async () => {
		mocks.getIdToken.mockResolvedValue(createIdToken({ groups: ['nao-viewers'] }));
		mocks.listProjectMembershipsForUser.mockResolvedValue([
			{ projectId: 'project-admin', projectPath: '/projects/admin', role: 'admin' },
			{ projectId: 'project-context-admin', projectPath: '/projects/context-admin', role: 'context_admin' },
			{ projectId: 'project-user', projectPath: '/projects/user', role: 'user' },
		]);

		await syncRolesFromSsoGroups('user-1');

		expect(mocks.updateProjectMemberRole).toHaveBeenCalledTimes(3);
		expect(mocks.cleanupContextWorktree).toHaveBeenCalledTimes(2);
		expect(mocks.cleanupContextWorktree).toHaveBeenNthCalledWith(1, 'project-admin', '/projects/admin', 'user-1');
		expect(mocks.cleanupContextWorktree).toHaveBeenNthCalledWith(
			2,
			'project-context-admin',
			'/projects/context-admin',
			'user-1',
		);
	});

	it('continues updating projects when one worktree cleanup fails', async () => {
		mocks.getIdToken.mockResolvedValue(createIdToken({ groups: ['nao-viewers'] }));
		mocks.listProjectMembershipsForUser.mockResolvedValue([
			{ projectId: 'project-1', projectPath: '/projects/one', role: 'admin' },
			{ projectId: 'project-2', projectPath: '/projects/two', role: 'context_admin' },
		]);
		mocks.cleanupContextWorktree
			.mockRejectedValueOnce(new Error('cleanup failed'))
			.mockResolvedValueOnce(undefined);

		await syncRolesFromSsoGroups('user-1');

		expect(mocks.updateProjectMemberRole).toHaveBeenNthCalledWith(1, 'project-1', 'user-1', 'viewer');
		expect(mocks.updateProjectMemberRole).toHaveBeenNthCalledWith(2, 'project-2', 'user-1', 'viewer');
		expect(mocks.cleanupContextWorktree).toHaveBeenCalledTimes(2);
		expect(mocks.logger.warn).toHaveBeenCalledWith('Failed to clean up context worktree after SSO group demotion', {
			source: 'system',
			context: {
				projectId: 'project-1',
				userId: 'user-1',
				error: { message: 'cleanup failed' },
			},
		});
	});
});

describe('parseGroupRoleMapping', () => {
	it('parses a comma-separated list of group:role pairs', () => {
		const mapping = parseGroupRoleMapping('nao-admins:admin,nao-viewers:viewer');
		expect(mapping.get('nao-admins')).toBe('admin');
		expect(mapping.get('nao-viewers')).toBe('viewer');
	});

	it('lowercases group names so claim casing does not matter', () => {
		expect(parseGroupRoleMapping('NAO-Admins:admin').get('nao-admins')).toBe('admin');
	});

	it('trims whitespace around entries', () => {
		expect(parseGroupRoleMapping(' nao-admins : admin , nao-users : user ').get('nao-users')).toBe('user');
	});

	it('supports context_admin', () => {
		expect(parseGroupRoleMapping('nao-context:context_admin').get('nao-context')).toBe('context_admin');
	});

	it('keeps colons that belong to the group name', () => {
		expect(parseGroupRoleMapping('okta:group:admins:admin').get('okta:group:admins')).toBe('admin');
	});

	it('drops entries with an unknown role rather than failing', () => {
		const mapping = parseGroupRoleMapping('nao-admins:superuser,nao-users:user');
		expect(mapping.has('nao-admins')).toBe(false);
		expect(mapping.get('nao-users')).toBe('user');
	});

	it('drops entries without a separator', () => {
		expect(parseGroupRoleMapping('nao-admins').size).toBe(0);
	});

	it('returns an empty mapping when unset', () => {
		expect(parseGroupRoleMapping(undefined).size).toBe(0);
		expect(parseGroupRoleMapping('').size).toBe(0);
	});
});

describe('resolveRoleFromGroups', () => {
	const mapping = parseGroupRoleMapping(
		'nao-admins:admin,nao-context:context_admin,nao-users:user,nao-viewers:viewer',
	);

	it('resolves a single matching group', () => {
		expect(resolveRoleFromGroups(['nao-users'], mapping)).toBe('user');
	});

	it('picks the most privileged role when several groups match', () => {
		expect(resolveRoleFromGroups(['nao-viewers', 'nao-admins', 'nao-users'], mapping)).toBe('admin');
	});

	it('ranks context_admin above user', () => {
		expect(resolveRoleFromGroups(['nao-users', 'nao-context'], mapping)).toBe('context_admin');
	});

	it('ignores groups that are not mapped', () => {
		expect(resolveRoleFromGroups(['everyone', 'nao-viewers'], mapping)).toBe('viewer');
	});

	it('is case-insensitive on group names', () => {
		expect(resolveRoleFromGroups(['NAO-Admins'], mapping)).toBe('admin');
	});

	it('returns null when no group matches', () => {
		expect(resolveRoleFromGroups(['everyone'], mapping)).toBeNull();
		expect(resolveRoleFromGroups([], mapping)).toBeNull();
	});
});

describe('decideGroupRoleMapping', () => {
	const mapping = parseGroupRoleMapping('nao-admins:admin,nao-users:user');

	it('allows access and returns the resolved role when a group matches', () => {
		expect(decideGroupRoleMapping({ groups: ['nao-users'] }, 'groups', mapping)).toEqual({
			action: 'allow',
			role: 'user',
			claimPresent: true,
		});
	});

	it('denies access when the claim is present but no group matches', () => {
		expect(decideGroupRoleMapping({ groups: ['everyone'] }, 'groups', mapping)).toEqual({
			action: 'deny',
			role: null,
			claimPresent: true,
		});
		expect(decideGroupRoleMapping({ groups: [] }, 'groups', mapping).action).toBe('deny');
	});

	it('denies access when the claim is present in an unsupported format', () => {
		expect(decideGroupRoleMapping({ groups: 42 }, 'groups', mapping).action).toBe('deny');
	});

	it('allows access without a role when the claim is missing', () => {
		expect(decideGroupRoleMapping({}, 'groups', mapping)).toEqual({
			action: 'allow',
			role: null,
			claimPresent: false,
		});
	});

	it('allows access without a role when claims could not be decoded', () => {
		expect(decideGroupRoleMapping(null, 'groups', mapping)).toEqual({
			action: 'allow',
			role: null,
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

function createIdToken(claims: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `${header}.${payload}.`;
}
