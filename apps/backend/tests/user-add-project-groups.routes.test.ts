import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addProjectMember: vi.fn(),
	addProjectMemberWithUserGroups: vi.fn(),
	addTeamMember: vi.fn(),
	hasFeature: vi.fn(),
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

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/memory', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	addProjectMember: mocks.addProjectMember,
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getProjectMember: vi.fn(),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/queries/user-group.queries', () => ({
	UserGroupQueryError: mocks.UserGroupQueryError,
	validateAssignableUserGroupIds: mocks.validateAssignableUserGroupIds,
}));
vi.mock('../src/queries/user-preference.queries', () => ({}));
vi.mock('../src/services/context-explorer-git.service', () => ({ cleanupContextWorktree: vi.fn() }));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));
vi.mock('../src/services/project-user-group-membership.service', () => ({
	addProjectMemberWithUserGroups: mocks.addProjectMemberWithUserGroups,
}));
vi.mock('../src/services/team-member', () => ({ addTeamMember: mocks.addTeamMember }));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));
vi.mock('../src/utils/email-builders', () => ({ buildUserAddedEmail: vi.fn() }));

import { router } from '../src/trpc/trpc';
import { userRoutes } from '../src/trpc/user.routes';

const testRouter = router(userRoutes);

describe('add user to project groups', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	it('preserves unlicensed onboarding when no groups are selected', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().addUserToProject({ email: 'added@example.com' })).resolves.toMatchObject({
			newUser: { id: 'added-user-id' },
		});
		expect(mocks.hasFeature).not.toHaveBeenCalled();
		expect(mocks.validateAssignableUserGroupIds).not.toHaveBeenCalled();
		expect(mocks.addProjectMember).toHaveBeenCalledOnce();
		expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
	});

	it('requires a license before adding a user with groups', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(
			createCaller().addUserToProject({ email: 'added@example.com', groupIds: ['analysts'] }),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'User Groups requires the Enterprise user-groups feature.',
		});
		expect(mocks.validateAssignableUserGroupIds).not.toHaveBeenCalled();
		expect(mocks.addTeamMember).not.toHaveBeenCalled();
		expect(mocks.addProjectMember).not.toHaveBeenCalled();
		expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
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
				createCaller().addUserToProject({ email: 'added@example.com', groupIds: [groupId] }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
			expect(mocks.addTeamMember).not.toHaveBeenCalled();
			expect(mocks.addProjectMember).not.toHaveBeenCalled();
			expect(mocks.addProjectMemberWithUserGroups).not.toHaveBeenCalled();
		},
	);

	it('deduplicates valid groups and adds the project and group memberships atomically', async () => {
		await createCaller().addUserToProject({
			email: 'added@example.com',
			groupIds: ['analysts', 'analysts', 'finance'],
		});

		expect(mocks.hasFeature).toHaveBeenCalledWith('user-groups');
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

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: {
				id: 'admin-id',
				name: 'Admin',
				email: 'admin@example.com',
			},
		},
		selectedProjectId: 'project-id',
	} as never);
}
