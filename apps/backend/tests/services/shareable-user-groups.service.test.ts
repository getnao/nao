import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listActiveUserGroups: vi.fn(),
	listUserGroupMemberships: vi.fn(),
	listUserGroupSsoMemberships: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
}));

vi.mock('../../src/services/user-group-availability.service', () => ({
	listActiveUserGroups: mocks.listActiveUserGroups,
}));

vi.mock('../../src/queries/user-group.queries', () => ({
	listUserGroupMemberships: mocks.listUserGroupMemberships,
	listUserGroupSsoMemberships: mocks.listUserGroupSsoMemberships,
}));

vi.mock('../../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));

import { listShareableUserGroupMemberIds } from '../../src/services/shareable-user-groups.service';

const PROJECT_ID = 'project-1';

const defaultGroup = { id: 'default', name: 'All Users', isDefault: true };
const groupA = { id: 'group-a', name: 'Group A', isDefault: false };
const groupB = { id: 'group-b', name: 'Group B', isDefault: false };

describe('listShareableUserGroupMemberIds', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listActiveUserGroups.mockResolvedValue([defaultGroup, groupA, groupB]);
		mocks.listUserGroupMemberships.mockResolvedValue([
			{ groupId: 'group-a', userId: 'user-1' },
			{ groupId: 'group-a', userId: 'user-2' },
			{ groupId: 'group-b', userId: 'user-2' },
			{ groupId: 'group-b', userId: 'user-3' },
			{ groupId: 'default', userId: 'user-1' },
		]);
		mocks.listUserGroupSsoMemberships.mockResolvedValue([]);
		mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]);
	});

	it('returns members of the requested shareable groups', async () => {
		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['group-a']);
		expect(result).toEqual(expect.arrayContaining(['user-1', 'user-2']));
		expect(result).toHaveLength(2);
	});

	it('excludes the default group', async () => {
		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['default']);
		expect(result).toEqual([]);
	});

	it('excludes members without project access', async () => {
		mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'user-1' }]);

		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['group-a']);
		expect(result).toEqual(['user-1']);
	});

	it('deduplicates members across multiple groups', async () => {
		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['group-a', 'group-b']);
		expect(result).toEqual(expect.arrayContaining(['user-1', 'user-2', 'user-3']));
		expect(result).toHaveLength(3);
	});

	it('excludes non-existent group IDs', async () => {
		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['nonexistent']);
		expect(result).toEqual([]);
	});

	it('returns empty for an empty group ID list', async () => {
		const result = await listShareableUserGroupMemberIds(PROJECT_ID, []);
		expect(result).toEqual([]);
		expect(mocks.listActiveUserGroups).not.toHaveBeenCalled();
	});

	it('includes SSO memberships', async () => {
		mocks.listUserGroupSsoMemberships.mockResolvedValue([{ groupId: 'group-b', userId: 'user-1' }]);

		const result = await listShareableUserGroupMemberIds(PROJECT_ID, ['group-b']);
		expect(result).toEqual(expect.arrayContaining(['user-1', 'user-2', 'user-3']));
		expect(result).toHaveLength(3);
	});
});
