import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInProject: vi.fn(),
	updateProjectMemberRole: vi.fn(),
	getUserProfile: vi.fn(),
	getUserName: vi.fn(),
	updateUser: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/memory', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: mocks.getUserRoleInProject,
	checkProjectHasMoreThanOneAdmin: vi.fn(async () => true),
	updateProjectMemberRole: mocks.updateProjectMemberRole,
}));
vi.mock('../src/queries/user.queries', () => ({
	getUserProfile: mocks.getUserProfile,
	getUserName: mocks.getUserName,
	updateUser: mocks.updateUser,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../src/queries/user-group.queries', () => ({}));
vi.mock('../src/queries/user-preference.queries', () => ({}));
vi.mock('../src/services/context-explorer-git.service', () => ({}));
vi.mock('../src/services/project-user-group-membership.service', () => ({}));
vi.mock('../src/services/team-member', () => ({}));
vi.mock('../src/services/user-group-availability.service', () => ({}));
vi.mock('../src/utils/email-builders', () => ({}));

import { router } from '../src/trpc/trpc';
import { userRoutes } from '../src/trpc/user.routes';

const testRouter = router(userRoutes);
const CALLER_ID = 'caller-id';

describe('user.get', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserProfile.mockImplementation(async (userId: string) => ({
			id: userId,
			name: 'Someone',
			email: 'someone@example.com',
			image: null,
		}));
	});

	it('refuses an admin reading a user outside their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });

		await expect(createCaller().get({ userId: 'foreign-user-id' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mocks.getUserProfile).not.toHaveBeenCalled();
	});

	it('refuses a non-admin reading another project member', async () => {
		mockRoles({ [CALLER_ID]: 'user', 'member-id': 'user' });

		await expect(createCaller().get({ userId: 'member-id' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.getUserProfile).not.toHaveBeenCalled();
	});

	it('lets an admin read a member of their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'viewer' });

		await expect(createCaller().get({ userId: 'member-id' })).resolves.toMatchObject({ id: 'member-id' });
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'member-id');
	});

	it('lets any user read their own profile', async () => {
		mockRoles({ [CALLER_ID]: 'viewer' });

		await expect(createCaller().get({ userId: CALLER_ID })).resolves.toMatchObject({ id: CALLER_ID });
	});
});

describe('user.modify', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserName.mockResolvedValue('Original Name');
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);
	});

	it('refuses an admin renaming a user outside their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });

		await expect(createCaller().modify({ userId: 'foreign-user-id', name: 'Pwned' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
	});

	it('lets an admin rename a member of their project', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'user' });

		await createCaller().modify({ userId: 'member-id', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('member-id', 'New Name');
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('member-id', 'org-id');
	});

	it('refuses an admin renaming a project member who also belongs to another organization', async () => {
		mockRoles({ [CALLER_ID]: 'admin', 'member-id': 'user' });
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(
			createCaller().modify({ userId: 'member-id', name: 'Pwned', newRole: 'viewer' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.updateProjectMemberRole).not.toHaveBeenCalled();
	});

	it('lets an admin rename themselves whatever else they belong to', async () => {
		mockRoles({ [CALLER_ID]: 'admin' });
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await createCaller().modify({ userId: CALLER_ID, name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith(CALLER_ID, 'New Name');
	});
});

function mockRoles(roles: Record<string, string>) {
	mocks.getUserRoleInProject.mockImplementation(async (_projectId: string, userId: string) => roles[userId] ?? null);
}

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: CALLER_ID, name: 'Caller', email: 'caller@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
