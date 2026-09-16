import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listActiveUserGroups: vi.fn(),
}));

vi.mock('../src/services/user-group-availability.service', () => ({
	listActiveUserGroups: mocks.listActiveUserGroups,
}));

import { listEffectiveEntraUserGroupMappings } from '../src/services/entra-user-group-mapping.service';
import { listEffectiveOidcUserGroupMappings } from '../src/services/oidc-user-group-mapping.service';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.listActiveUserGroups.mockResolvedValue([
		{ id: 'analysts-id', name: 'Analysts', isDefault: false },
		{ id: 'marketing-id', name: 'Marketing', isDefault: false },
		{ id: 'all-users-id', name: 'All Users', isDefault: true },
	]);
});

describe('listEffectiveOidcUserGroupMappings', () => {
	it('resolves wildcard mappings and lets the current project override them', async () => {
		const mappings = [
			{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'analysts' },
			{ oidcGroup: 'finance', projectScope: 'project-1', naoUserGroup: 'marketing' },
			{ oidcGroup: 'sales', projectScope: '*', naoUserGroup: 'analysts' },
		];

		await expect(listEffectiveOidcUserGroupMappings('project-1', mappings)).resolves.toEqual([
			{ identifier: 'finance', targetGroupId: 'marketing-id', targetGroupName: 'Marketing' },
			{ identifier: 'sales', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);
	});

	it('does not expose mappings belonging only to another project', async () => {
		await expect(
			listEffectiveOidcUserGroupMappings('project-1', [
				{ oidcGroup: 'finance', projectScope: 'project-2', naoUserGroup: 'analysts' },
			]),
		).resolves.toEqual([]);
	});

	it('reports missing, default, and unavailable targets as unresolved overrides', async () => {
		await expect(
			listEffectiveOidcUserGroupMappings('project-1', [
				{ oidcGroup: 'missing', projectScope: '*', naoUserGroup: 'missing group' },
				{ oidcGroup: 'everyone', projectScope: '*', naoUserGroup: 'all users' },
				{ oidcGroup: 'locked', projectScope: '*', naoUserGroup: 'locked group' },
			]),
		).resolves.toEqual([
			{ identifier: 'missing', targetGroupId: null, targetGroupName: 'missing group' },
			{ identifier: 'everyone', targetGroupId: null, targetGroupName: 'all users' },
			{ identifier: 'locked', targetGroupId: null, targetGroupName: 'locked group' },
		]);
		expect(mocks.listActiveUserGroups).toHaveBeenCalledWith('project-1');
	});

	it('matches target User Group names case-insensitively', async () => {
		await expect(
			listEffectiveOidcUserGroupMappings('project-1', [
				{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'ANALYSTS' },
			]),
		).resolves.toEqual([{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' }]);
	});
});

describe('listEffectiveEntraUserGroupMappings', () => {
	it('reports unresolved Entra targets without activating a UI fallback', async () => {
		const groupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		await expect(
			listEffectiveEntraUserGroupMappings('project-1', [
				{ entraGroupId: groupId, projectScope: '*', naoUserGroup: 'missing group' },
			]),
		).resolves.toEqual([{ identifier: groupId, targetGroupId: null, targetGroupName: 'missing group' }]);
	});
});
