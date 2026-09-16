import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addDefaultOrganization: vi.fn(),
	isCloud: false,
	isOidc: vi.fn(),
	syncRoles: vi.fn(),
	syncUserGroups: vi.fn(),
	syncMicrosoftUserGroups: vi.fn(),
}));

vi.mock('../src/env', () => ({
	get isCloud() {
		return mocks.isCloud;
	},
}));
vi.mock('../src/queries/organization.queries', () => ({
	addUserToDefaultOrganizationIfExists: mocks.addDefaultOrganization,
}));
vi.mock('../src/services/oidc-auth.service', () => ({
	isSocialProviderOidc: mocks.isOidc,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	syncOrganizationRoleFromSsoGroups: mocks.syncRoles,
}));
vi.mock('../src/services/sso-user-group-membership.service', () => ({
	syncUserGroupsFromOidc: mocks.syncUserGroups,
}));
vi.mock('../src/services/microsoft-user-group-membership.service', () => ({
	syncUserGroupsFromMicrosoft: mocks.syncMicrosoftUserGroups,
}));

import { syncSsoLoginGroups } from '../src/services/sso-login-sync.service';

beforeEach(() => {
	mocks.isCloud = false;
	mocks.addDefaultOrganization.mockReset().mockResolvedValue(undefined);
	mocks.isOidc.mockReset();
	mocks.syncRoles.mockReset().mockResolvedValue(undefined);
	mocks.syncUserGroups.mockReset().mockResolvedValue(undefined);
	mocks.syncMicrosoftUserGroups.mockReset().mockResolvedValue(undefined);
});

describe('syncSsoLoginGroups', () => {
	it('restores the organization before OIDC User Group and role sync', async () => {
		const calls: string[] = [];
		mocks.isOidc.mockReturnValue(true);
		mocks.addDefaultOrganization.mockImplementation(async () => {
			calls.push('organization');
		});
		mocks.syncUserGroups.mockImplementation(async () => {
			calls.push('groups');
		});
		mocks.syncRoles.mockImplementation(async () => {
			calls.push('roles');
		});
		await syncSsoLoginGroups('user-1', 'okta');
		expect(mocks.syncRoles).toHaveBeenCalledWith('user-1');
		expect(mocks.syncUserGroups).toHaveBeenCalledWith('user-1');
		expect(mocks.syncMicrosoftUserGroups).not.toHaveBeenCalled();
		expect(calls).toEqual(['organization', 'groups', 'roles']);
	});

	it('keeps a default project role through same-login and later organization role sync', async () => {
		let explicitProjectRole: string | null = null;
		mocks.isOidc.mockReturnValue(true);
		mocks.syncUserGroups.mockImplementation(async () => {
			explicitProjectRole ??= 'context_admin';
		});
		mocks.syncRoles.mockImplementation(async () => {
			expect(explicitProjectRole).toBe('context_admin');
		});

		await syncSsoLoginGroups('user-1', 'okta');
		await syncSsoLoginGroups('user-1', 'okta');

		expect(explicitProjectRole).toBe('context_admin');
		expect(mocks.syncUserGroups).toHaveBeenCalledTimes(2);
		expect(mocks.syncRoles).toHaveBeenCalledTimes(2);
	});

	it('restores the organization before Microsoft User Group sync', async () => {
		const calls: string[] = [];
		mocks.addDefaultOrganization.mockImplementation(async () => {
			calls.push('organization');
		});
		mocks.syncMicrosoftUserGroups.mockImplementation(async () => {
			calls.push('groups');
		});
		await syncSsoLoginGroups('user-1', 'microsoft');
		expect(mocks.syncMicrosoftUserGroups).toHaveBeenCalledWith('user-1');
		expect(mocks.syncRoles).not.toHaveBeenCalled();
		expect(mocks.syncUserGroups).not.toHaveBeenCalled();
		expect(calls).toEqual(['organization', 'groups']);
	});

	it('does not dispatch for non-OIDC sessions', async () => {
		mocks.isOidc.mockReturnValue(false);
		await syncSsoLoginGroups('user-1', 'google');
		expect(mocks.addDefaultOrganization).not.toHaveBeenCalled();
		expect(mocks.syncRoles).not.toHaveBeenCalled();
		expect(mocks.syncUserGroups).not.toHaveBeenCalled();
		expect(mocks.syncMicrosoftUserGroups).not.toHaveBeenCalled();
	});

	it('does not restore the self-hosted default organization in cloud mode', async () => {
		mocks.isCloud = true;
		mocks.isOidc.mockReturnValue(true);
		await syncSsoLoginGroups('user-1', 'okta');
		expect(mocks.addDefaultOrganization).not.toHaveBeenCalled();
		expect(mocks.syncUserGroups).toHaveBeenCalledWith('user-1');
		expect(mocks.syncRoles).toHaveBeenCalledWith('user-1');
	});

	it('keeps login successful and preserves ordering when synchronization rejects', async () => {
		const calls: string[] = [];
		mocks.isOidc.mockReturnValue(true);
		mocks.addDefaultOrganization.mockImplementation(async () => {
			calls.push('organization');
			throw new Error('organization failure');
		});
		mocks.syncUserGroups.mockImplementation(async () => {
			calls.push('groups');
			throw new Error('group failure');
		});
		mocks.syncRoles.mockImplementation(async () => {
			calls.push('roles');
			throw new Error('role failure');
		});
		await expect(syncSsoLoginGroups('user-1', 'okta')).resolves.toBeUndefined();
		expect(mocks.syncRoles).toHaveBeenCalledWith('user-1');
		expect(calls).toEqual(['organization', 'groups', 'roles']);
	});
});
