import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertAdminPasswordResetAllowed } from '../src/utils/password-reset';

const routeMocks = vi.hoisted(() => ({
	isCloud: true,
	getAccountById: vi.fn(),
	getProjectByUserId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getUserOrgMembership: vi.fn(),
	getUserRoleInOrg: vi.fn(),
}));

vi.mock('../src/env', () => ({
	env: { DEFAULT_USER_ROLE: 'user' },
	get isCloud() {
		return routeMocks.isCloud;
	},
}));

vi.mock('../src/auth', () => ({
	getAuth: vi.fn(),
}));

vi.mock('../src/queries/account.queries', () => ({
	getAccountById: routeMocks.getAccountById,
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: routeMocks.getProjectByUserId,
	getUserRoleInProject: routeMocks.getUserRoleInProject,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: routeMocks.getUserOrgMembership,
	getUserRoleInOrg: routeMocks.getUserRoleInOrg,
}));

vi.mock('../src/queries/user.queries', () => ({}));

vi.mock('../src/services/email', () => ({
	emailService: { sendEmail: vi.fn() },
}));

vi.mock('../src/services/team-member', () => ({
	addTeamMember: vi.fn(),
}));

describe('admin password reset boundary', () => {
	beforeEach(() => {
		routeMocks.isCloud = true;
		routeMocks.getAccountById.mockReset();
		routeMocks.getProjectByUserId.mockReset();
		routeMocks.getUserRoleInProject.mockReset();
		routeMocks.getUserOrgMembership.mockReset();
		routeMocks.getUserRoleInOrg.mockReset();
	});

	it('blocks administrator password resets in cloud mode', () => {
		expect(() => assertAdminPasswordResetAllowed(true)).toThrowError(
			expect.objectContaining({
				code: 'FORBIDDEN',
				message:
					'Administrator password resets are unavailable in nao cloud. Use self-service password recovery instead.',
			}),
		);
	});

	it('preserves administrator password resets in self-hosted mode', () => {
		expect(() => assertAdminPasswordResetAllowed(false)).not.toThrow();
	});

	it('uses a tRPC error for cloud rejections', () => {
		expect(() => assertAdminPasswordResetAllowed(true)).toThrowError(TRPCError);
	});

	it('blocks the project administrator procedure before account access', async () => {
		routeMocks.getProjectByUserId.mockResolvedValue({ id: 'project-1' });
		routeMocks.getUserRoleInProject.mockResolvedValue('admin');
		const caller = await createAccountCaller();

		await expect(caller.resetPassword({ userId: 'target-user' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(routeMocks.getAccountById).not.toHaveBeenCalled();
	});

	it('blocks the organization administrator procedure before account access', async () => {
		routeMocks.getUserOrgMembership.mockResolvedValue({
			organization: { id: 'org-1', name: 'Finance' },
			role: 'admin',
		});
		const caller = await createOrganizationCaller();

		await expect(caller.resetMemberPassword({ userId: 'target-user' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(routeMocks.getUserRoleInOrg).not.toHaveBeenCalled();
		expect(routeMocks.getAccountById).not.toHaveBeenCalled();
	});

	it('keeps both procedures available to self-hosted administrators', async () => {
		routeMocks.isCloud = false;
		routeMocks.getProjectByUserId.mockResolvedValue({ id: 'project-1' });
		routeMocks.getUserRoleInProject.mockResolvedValue('admin');
		routeMocks.getUserOrgMembership.mockResolvedValue({
			organization: { id: 'org-1', name: 'Finance' },
			role: 'admin',
		});
		routeMocks.getUserRoleInOrg.mockResolvedValue('user');
		routeMocks.getAccountById.mockResolvedValue(null);

		const accountCaller = await createAccountCaller();
		const organizationCaller = await createOrganizationCaller();

		await expect(accountCaller.resetPassword({ userId: 'target-user' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		await expect(organizationCaller.resetMemberPassword({ userId: 'target-user' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(routeMocks.getAccountById).toHaveBeenCalledTimes(2);
	});
});

async function createAccountCaller() {
	const [{ accountRoutes }, { router }] = await Promise.all([
		import('../src/trpc/account.routes'),
		import('../src/trpc/trpc'),
	]);
	return router(accountRoutes).createCaller(createCallerContext());
}

async function createOrganizationCaller() {
	const [{ organizationRoutes }, { router }] = await Promise.all([
		import('../src/trpc/organization.routes'),
		import('../src/trpc/trpc'),
	]);
	return router(organizationRoutes).createCaller(createCallerContext());
}

function createCallerContext() {
	return {
		session: {
			user: { id: 'admin-user' },
		},
		selectedProjectId: 'project-1',
	} as never;
}
