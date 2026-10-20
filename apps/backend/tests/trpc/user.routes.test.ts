import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	addProjectMember: vi.fn(),
	addProjectMemberWithUserGroups: vi.fn(),
	addTeamMember: vi.fn(),
	getUserName: vi.fn(),
	getUserProfile: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	organizationRoleMappingActive: false,
	updateProjectMemberRole: vi.fn(),
	updateUser: vi.fn(),
	UserGroupQueryError: class UserGroupQueryError extends Error {
		constructor(
			public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT',
			message: string,
		) {
			super(message);
		}
	},
	validateAssignableUserGroupIds: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/memory', () => ({}));
vi.mock('../../src/queries/project.queries', () => ({
	addProjectMember: mocks.addProjectMember,
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: '/project' })),
	getProjectMember: vi.fn(),
	getUserRoleInProject: mocks.getUserRoleInProject,
	checkProjectHasMoreThanOneAdmin: vi.fn(async () => true),
	updateProjectMemberRole: mocks.updateProjectMemberRole,
}));
vi.mock('../../src/queries/user.queries', () => ({
	getUserProfile: mocks.getUserProfile,
	getUserName: mocks.getUserName,
	updateUser: mocks.updateUser,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../../src/queries/user-group.queries', () => ({
	UserGroupQueryError: mocks.UserGroupQueryError,
	validateAssignableUserGroupIds: mocks.validateAssignableUserGroupIds,
}));
vi.mock('../../src/queries/user-preference.queries', () => ({}));
vi.mock('../../src/services/context-explorer-git.service', () => ({ cleanupContextWorktree: vi.fn() }));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));
vi.mock('../../src/services/project-user-group-membership.service', () => ({
	addProjectMemberWithUserGroups: mocks.addProjectMemberWithUserGroups,
}));
vi.mock('../../src/services/team-member', () => ({ addTeamMember: mocks.addTeamMember }));
vi.mock('../../src/services/user-group-availability.service', () => ({
	validateAssignableUserGroupIds: mocks.validateAssignableUserGroupIds,
}));
vi.mock('../../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => mocks.organizationRoleMappingActive),
}));
vi.mock('../../src/utils/email-builders', () => ({ buildUserAddedEmail: vi.fn() }));

import { router } from '../../src/trpc/trpc';
import { userRoutes } from '../../src/trpc/user.routes';

const testRouter = router(userRoutes);
const CALLER_ID = 'caller-id';
const caller = createTestCaller(testRouter, { userId: CALLER_ID });

beforeEach(() => {
	vi.resetAllMocks();
	mocks.organizationRoleMappingActive = false;
});

describe('user.get', () => {
	beforeEach(() => {
		mocks.getUserProfile.mockImplementation(async (userId: string) => ({
			id: userId,
			name: 'Someone',
			email: 'someone@example.com',
			image: null,
		}));
	});

	it('refuses an admin reading a user outside their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });

		await expect(caller.get({ userId: 'foreign-user-id' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mocks.getUserProfile).not.toHaveBeenCalled();
	});

	it('refuses a non-admin reading another project member', async () => {
		mockRoles({ [CALLER_ID]: 'user', 'member-id': 'user' });

		await expect(caller.get({ userId: 'member-id' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.getUserProfile).not.toHaveBeenCalled();
	});

	it('lets an admin read a member of their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'viewer' });

		await expect(caller.get({ userId: 'member-id' })).resolves.toMatchObject({ id: 'member-id' });
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'member-id');
	});

	it('lets any user read their own profile', async () => {
		mockRoles({ [CALLER_ID]: 'viewer' });

		await expect(caller.get({ userId: CALLER_ID })).resolves.toMatchObject({ id: CALLER_ID });
	});
});

describe('user.modify', () => {
	beforeEach(() => {
		mocks.getUserName.mockResolvedValue('Original Name');
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);
	});

	it('refuses an admin renaming a user outside their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });

		await expect(caller.modify({ userId: 'foreign-user-id', name: 'Pwned' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
	});

	it('lets an admin rename a member of their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'user' });

		await caller.modify({ userId: 'member-id', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('member-id', 'New Name');
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('member-id', 'org-id');
	});

	it('refuses an admin renaming a project member who also belongs to another organization', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'user' });
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(caller.modify({ userId: 'member-id', name: 'Pwned', newRole: 'viewer' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
	});

	it('lets an admin rename themselves whatever else they belong to', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await caller.modify({ userId: CALLER_ID, name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith(CALLER_ID, 'New Name');
	});
});

describe('add user to project groups', () => {
	beforeEach(() => {
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getUserName.mockResolvedValue('Existing User');
		mocks.hasFeature.mockResolvedValue(true);
		mocks.validateAssignableUserGroupIds.mockImplementation(async (_projectId, groupIds) => groupIds);
		mocks.addTeamMember.mockImplementation(async ({ addMember }) => {
			await addMember('added-user-id');
			return {
				newUser: {
					id: 'added-user-id',
					name: 'Added User',
					email: 'added@example.com',
					role: 'user',
				},
			};
		});
	});

	it('allows project role changes while organization roles are managed by the identity provider', async () => {
		mocks.organizationRoleMappingActive = true;

		await expect(caller.modify({ userId: 'member-id', newRole: 'viewer' })).resolves.toBeUndefined();
		expect(mocks.updateProjectMemberRole).toHaveBeenCalledWith('project-id', 'member-id', 'viewer');
	});

	it('rejects organization role changes through the editability helper when managed by the identity provider', async () => {
		mocks.organizationRoleMappingActive = true;
		const { assertOrganizationRolesAreEditable } = await import('../../src/trpc/trpc');

		await expect(assertOrganizationRolesAreEditable()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Organization roles are managed by your identity provider and cannot be changed here.',
		});
	});

	it('preserves unlicensed onboarding when no groups are selected', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(caller.addUserToProject({ email: 'added@example.com' })).resolves.toMatchObject({
			newUser: { id: 'added-user-id' },
		});
		expect(mocks.hasFeature).not.toHaveBeenCalled();
		expect(mocks.validateAssignableUserGroupIds).not.toHaveBeenCalled();
		expect(mocks.addProjectMember).toHaveBeenCalledOnce();
		expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
	});

	it('adds a user with selected groups without unlimited entitlement', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(
			caller.addUserToProject({ email: 'added@example.com', groupIds: ['analysts'] }),
		).resolves.toMatchObject({ newUser: { id: 'added-user-id' } });
		expect(mocks.validateAssignableUserGroupIds).toHaveBeenCalledWith('project-id', ['analysts']);
		expect(mocks.addTeamMember).toHaveBeenCalledOnce();
		expect(mocks.addProjectMember).not.toHaveBeenCalled();
		expect(mocks.addProjectMemberWithUserGroups).toHaveBeenCalledOnce();
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it.each(['missing-group', 'foreign-group', 'all-users'])(
		'rejects %s before user or membership mutations',
		async (groupId) => {
			mocks.validateAssignableUserGroupIds.mockRejectedValueOnce(
				new mocks.UserGroupQueryError(
					'BAD_REQUEST',
					'One or more user groups cannot be assigned to this user.',
				),
			);

			await expect(
				caller.addUserToProject({ email: 'added@example.com', groupIds: [groupId] }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
			expect(mocks.addTeamMember).not.toHaveBeenCalled();
			expect(mocks.addProjectMember).not.toHaveBeenCalled();
			expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
		},
	);

	it('deduplicates valid groups and adds the project and group memberships atomically', async () => {
		await caller.addUserToProject({
			email: 'added@example.com',
			groupIds: ['analysts', 'analysts', 'finance'],
		});

		expect(mocks.hasFeature).not.toHaveBeenCalled();
		expect(mocks.validateAssignableUserGroupIds).toHaveBeenCalledWith('project-id', ['analysts', 'finance']);
		expect(mocks.addProjectMemberWithUserGroups).toHaveBeenCalledWith(
			{
				userId: 'added-user-id',
				projectId: 'project-id',
				role: expect.any(String),
			},
			['analysts', 'finance'],
		);
		expect(mocks.addProjectMember).not.toHaveBeenCalled();
	});
});

function mockRoles(roles: Record<string, string>) {
	mocks.getUserRoleInProject.mockImplementation(async (_projectId: string, userId: string) => roles[userId] ?? null);
}
