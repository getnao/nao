import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInOrg: vi.fn(),
	getUserName: vi.fn(),
	updateUser: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	putOrganizationMember: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/account.queries', () => ({}));
vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: vi.fn(async () => ({ organization: { id: 'org-1', name: 'Org' }, role: 'admin' })),
	getUserRoleInOrg: mocks.getUserRoleInOrg,
}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/queries/usage.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({
	getUserName: mocks.getUserName,
	updateUser: mocks.updateUser,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../src/services/email', () => ({}));
vi.mock('../src/services/membership.service', () => ({ putOrganizationMember: mocks.putOrganizationMember }));
vi.mock('../src/services/team-member', () => ({}));
vi.mock('../src/utils/email-builders', () => ({}));

import { organizationRoutes } from '../src/trpc/organization.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ organization: organizationRoutes });

describe('organization.modifyMember', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserRoleInOrg.mockResolvedValue('user');
		mocks.getUserName.mockResolvedValue('Original Name');
	});

	it('refuses to rename a member who also belongs to another organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(
			createCaller().organization.modifyMember({ userId: 'victim-1', name: 'Pwned', newRole: 'admin' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('victim-1', 'org-1');
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.putOrganizationMember).not.toHaveBeenCalled();
	});

	it('renames a member who belongs only to this organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);

		await createCaller().organization.modifyMember({ userId: 'member-1', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('member-1', 'New Name');
	});

	it('lets an admin rename themselves', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await createCaller().organization.modifyMember({ userId: 'admin-1', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('admin-1', 'New Name');
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' } },
		selectedProjectId: null,
	} as never);
}
