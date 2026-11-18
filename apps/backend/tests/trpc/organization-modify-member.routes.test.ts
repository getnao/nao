import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	getUserRoleInOrg: vi.fn(),
	getUserName: vi.fn(),
	updateUser: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	putOrganizationMember: vi.fn(),
	getUserOrgMembership: vi.fn(),
	updateOrganizationPolicy: vi.fn(),
	resetUserTwoFactor: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/account.queries', () => ({}));
vi.mock('../../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
	getUserRoleInOrg: mocks.getUserRoleInOrg,
	listOrgMembersWithUsers: vi.fn(async () => [{ id: 'member-1', twoFactorEnabled: true }]),
}));
vi.mock('../../src/queries/two-factor.queries', () => ({
	updateOrganizationPolicy: mocks.updateOrganizationPolicy,
	resetUserTwoFactor: mocks.resetUserTwoFactor,
}));
vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/queries/usage.queries', () => ({}));
vi.mock('../../src/queries/user.queries', () => ({
	getUserName: mocks.getUserName,
	updateUser: mocks.updateUser,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../../src/services/email', () => ({}));
vi.mock('../../src/services/membership.service', () => ({ putOrganizationMember: mocks.putOrganizationMember }));
vi.mock('../../src/services/team-member', () => ({}));
vi.mock('../../src/utils/email-builders', () => ({}));

import { organizationRoutes } from '../../src/trpc/organization.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router({ organization: organizationRoutes });
const caller = createTestCaller(testRouter, { userId: 'admin-1', selectedProjectId: null });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getUserOrgMembership.mockResolvedValue({ organization: { id: 'org-1', name: 'Org' }, role: 'admin' });
	mocks.getUserRoleInOrg.mockResolvedValue('user');
	mocks.getUserName.mockResolvedValue('Original Name');
});

describe('organization.modifyMember', () => {
	it('refuses to rename a member who also belongs to another organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(
			caller.organization.modifyMember({ userId: 'victim-1', name: 'Pwned', newRole: 'admin' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('victim-1', 'org-1');
		expect(mocks.updateUser).not.toHaveBeenCalled();
		expect(mocks.putOrganizationMember).not.toHaveBeenCalled();
	});

	it('renames a member who belongs only to this organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);

		await caller.organization.modifyMember({ userId: 'member-1', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('member-1', 'New Name');
	});

	it('lets an admin rename themselves', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await caller.organization.modifyMember({ userId: 'admin-1', name: 'New Name' });
		expect(mocks.updateUser).toHaveBeenCalledWith('admin-1', 'New Name');
	});
});

describe('organization two-factor authentication', () => {
	it('saves the policy for an admin', async () => {
		await caller.organization.updateTwoFactorPolicy({ required: true, emailCodes: false });

		expect(mocks.updateOrganizationPolicy).toHaveBeenCalledWith('org-1', { required: true, emailCodes: false });
	});

	it('keeps the policy and who has a second factor away from non-admins', async () => {
		mocks.getUserOrgMembership.mockResolvedValue({ organization: { id: 'org-1' }, role: 'user' });

		await expect(
			caller.organization.updateTwoFactorPolicy({ required: false, emailCodes: true }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(await caller.organization.getMembers()).toEqual([{ id: 'member-1', twoFactorEnabled: undefined }]);
		expect(mocks.updateOrganizationPolicy).not.toHaveBeenCalled();
	});

	it.each([
		{ reason: 'is not a member', memberRole: null, isConfined: true },
		{ reason: 'also belongs to another organization', memberRole: 'user', isConfined: false },
	])('refuses to reset the second factor of a user who $reason', async ({ memberRole, isConfined }) => {
		mocks.getUserRoleInOrg.mockResolvedValue(memberRole);
		mocks.isUserConfinedToOrganization.mockResolvedValue(isConfined);

		await expect(caller.organization.resetMemberTwoFactor({ userId: 'member-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.resetUserTwoFactor).not.toHaveBeenCalled();
	});

	it('resets the second factor of a member of this organization only', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);

		await caller.organization.resetMemberTwoFactor({ userId: 'member-1' });

		expect(mocks.resetUserTwoFactor).toHaveBeenCalledWith('member-1');
	});
});
