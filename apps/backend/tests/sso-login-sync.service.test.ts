import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	isOidc: vi.fn(),
	syncRoles: vi.fn(),
	syncUserGroups: vi.fn(),
	syncMicrosoftUserGroups: vi.fn(),
}));

vi.mock('../src/services/oidc-auth.service', () => ({
	isSocialProviderOidc: mocks.isOidc,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	syncRolesFromSsoGroups: mocks.syncRoles,
}));
vi.mock('../src/services/sso-user-group-membership.service', () => ({
	syncUserGroupsFromOidc: mocks.syncUserGroups,
}));
vi.mock('../src/services/microsoft-user-group-membership.service', () => ({
	syncUserGroupsFromMicrosoft: mocks.syncMicrosoftUserGroups,
}));

import { syncSsoLoginGroups } from '../src/services/sso-login-sync.service';

beforeEach(() => {
	mocks.isOidc.mockReset();
	mocks.syncRoles.mockReset().mockResolvedValue(undefined);
	mocks.syncUserGroups.mockReset().mockResolvedValue(undefined);
	mocks.syncMicrosoftUserGroups.mockReset().mockResolvedValue(undefined);
});

describe('syncSsoLoginGroups', () => {
	it('dispatches role and User Group sync for OIDC sessions', async () => {
		mocks.isOidc.mockReturnValue(true);
		await syncSsoLoginGroups('user-1', 'okta');
		expect(mocks.syncRoles).toHaveBeenCalledWith('user-1');
		expect(mocks.syncUserGroups).toHaveBeenCalledWith('user-1');
		expect(mocks.syncMicrosoftUserGroups).not.toHaveBeenCalled();
	});

	it('dispatches only Microsoft User Group sync for Microsoft sessions', async () => {
		await syncSsoLoginGroups('user-1', 'microsoft');
		expect(mocks.syncMicrosoftUserGroups).toHaveBeenCalledWith('user-1');
		expect(mocks.syncRoles).not.toHaveBeenCalled();
		expect(mocks.syncUserGroups).not.toHaveBeenCalled();
	});

	it('does not dispatch for non-OIDC sessions', async () => {
		mocks.isOidc.mockReturnValue(false);
		await syncSsoLoginGroups('user-1', 'google');
		expect(mocks.syncRoles).not.toHaveBeenCalled();
		expect(mocks.syncUserGroups).not.toHaveBeenCalled();
		expect(mocks.syncMicrosoftUserGroups).not.toHaveBeenCalled();
	});

	it('keeps login successful if either sync rejects', async () => {
		mocks.isOidc.mockReturnValue(true);
		mocks.syncRoles.mockRejectedValue(new Error('role failure'));
		mocks.syncUserGroups.mockRejectedValue(new Error('group failure'));
		await expect(syncSsoLoginGroups('user-1', 'okta')).resolves.toBeUndefined();
	});
});
