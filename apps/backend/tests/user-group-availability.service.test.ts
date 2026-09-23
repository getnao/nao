import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserGroupOverview: vi.fn(),
	hasFeature: vi.fn(),
	listUserGroups: vi.fn(),
	resolveUserGroupAccess: vi.fn(),
	validateAssignableUserGroupIds: vi.fn(),
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));

vi.mock('../src/queries/user-group.queries', () => ({
	UserGroupQueryError: class UserGroupQueryError extends Error {
		constructor(
			public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN',
			message: string,
		) {
			super(message);
		}
	},
	getUserGroupOverview: mocks.getUserGroupOverview,
	listUserGroups: mocks.listUserGroups,
	resolveUserGroupAccess: mocks.resolveUserGroupAccess,
	validateAssignableUserGroupIds: mocks.validateAssignableUserGroupIds,
}));

import {
	applyCurrentUserGroupAvailability,
	assertUserGroupManageable,
	getAvailableUserGroupOverview,
	LOCKED_USER_GROUP_MESSAGE,
	resolveAvailableUserGroupAccess,
	validateAssignableUserGroupIds,
} from '../src/services/user-group-availability.service';

const createdAt = new Date('2025-01-01T00:00:00Z');
const updatedAt = new Date('2025-01-02T00:00:00Z');
const baseGroup = {
	projectId: 'project-id',
	featureGrants: ['storyCreation'] as const,
	toolCallDensityPolicy: { defaultDensity: 'compact' as const, canChange: true },
	databaseAccess: { mode: 'all' as const, strict: true },
	docsAccess: { mode: 'all' as const },
	ssoMappings: { version: 1 as const, providers: { oidc: ['stored'], microsoft: [] } },
	createdAt,
	updatedAt,
};
const groups = [
	{ ...baseGroup, id: 'default', name: 'All Users', isDefault: true },
	{ ...baseGroup, id: 'group-d', name: 'Fourth', isDefault: false, createdAt: new Date('2025-01-03') },
	{ ...baseGroup, id: 'group-b', name: 'Second', isDefault: false },
	{ ...baseGroup, id: 'group-a', name: 'First', isDefault: false },
	{ ...baseGroup, id: 'group-c', name: 'Third', isDefault: false, createdAt: new Date('2025-01-02') },
] as const;

describe('user group availability service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(false);
		mocks.listUserGroups.mockResolvedValue(groups);
		mocks.validateAssignableUserGroupIds.mockImplementation(async (_projectId, groupIds) => groupIds);
	});

	it('keeps All Users and the deterministic three oldest custom groups active', async () => {
		const available = await applyCurrentUserGroupAvailability([...groups]);

		expect(available.filter((group) => !group.isLocked).map((group) => group.id)).toEqual([
			'default',
			'group-b',
			'group-a',
			'group-c',
		]);
		expect(available.find((group) => group.id === 'group-d')).toEqual({
			id: 'group-d',
			projectId: 'project-id',
			name: 'Fourth',
			isDefault: false,
			isLocked: true,
			createdAt: new Date('2025-01-03'),
			updatedAt,
		});
	});

	it('redacts locked settings and memberships, then restores them when licensed', async () => {
		mocks.getUserGroupOverview.mockResolvedValue({
			users: [{ id: 'user-id' }],
			groups,
			memberships: [
				{ groupId: 'default', userId: 'user-id' },
				{ groupId: 'group-d', userId: 'user-id' },
			],
			ssoMemberships: [{ groupId: 'group-d', userId: 'user-id', provider: 'oidc' }],
		});

		const unlicensed = await getAvailableUserGroupOverview('project-id');
		expect(unlicensed.groups.find((group) => group.id === 'group-d')).not.toHaveProperty('featureGrants');
		expect(unlicensed.memberships).toEqual([{ groupId: 'default', userId: 'user-id' }]);
		expect(unlicensed.ssoMemberships).toEqual([]);

		mocks.hasFeature.mockResolvedValue(true);
		const licensed = await getAvailableUserGroupOverview('project-id');
		expect(licensed.groups.find((group) => group.id === 'group-d')).toMatchObject({
			isLocked: false,
			featureGrants: ['storyCreation'],
			ssoMappings: baseGroup.ssoMappings,
		});
		expect(licensed.memberships).toHaveLength(2);
		expect(licensed.ssoMemberships).toHaveLength(1);
	});

	it('uses only active groups for effective access', async () => {
		await resolveAvailableUserGroupAccess('project-id', 'user-id');

		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith(
			'project-id',
			'user-id',
			new Set(['default', 'group-a', 'group-b', 'group-c']),
		);
	});

	it('rejects management and assignment for locked groups', async () => {
		await expect(assertUserGroupManageable('project-id', 'group-d')).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: LOCKED_USER_GROUP_MESSAGE,
		});
		await expect(validateAssignableUserGroupIds('project-id', ['group-d'])).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: LOCKED_USER_GROUP_MESSAGE,
		});
		expect(mocks.validateAssignableUserGroupIds).not.toHaveBeenCalled();
	});
});
