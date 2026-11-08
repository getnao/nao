import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	role: 'admin' as 'admin' | 'user',
	emailEnabled: true,
	getUserRoleInOrg: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	updateOrganizationTwoFactorMethods: vi.fn(),
	resetUserTwoFactor: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/account.queries', () => ({}));
vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: vi.fn(async () => ({ organization: { id: 'org-1', name: 'Org' }, role: mocks.role })),
	getUserRoleInOrg: mocks.getUserRoleInOrg,
}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/queries/usage.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../src/queries/two-factor.queries', () => ({
	getOrganizationTwoFactorMethods: vi.fn(async () => ['totp', 'email']),
	updateOrganizationTwoFactorMethods: mocks.updateOrganizationTwoFactorMethods,
	resetUserTwoFactor: mocks.resetUserTwoFactor,
}));
vi.mock('../src/services/email', () => ({ emailService: { isEnabled: () => mocks.emailEnabled } }));
vi.mock('../src/services/membership.service', () => ({}));
vi.mock('../src/services/team-member', () => ({}));
vi.mock('../src/utils/email-builders', () => ({}));

import { organizationRoutes } from '../src/trpc/organization.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ organization: organizationRoutes });

describe('organization two-factor settings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'admin';
		mocks.emailEnabled = true;
		mocks.getUserRoleInOrg.mockResolvedValue('user');
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);
	});

	it('saves the allowed methods without duplicates', async () => {
		const result = await createCaller().organization.updateTwoFactorMethods({
			methods: ['email', 'totp', 'email'],
		});

		expect(result.methods).toEqual(['totp', 'email']);
		expect(mocks.updateOrganizationTwoFactorMethods).toHaveBeenCalledWith('org-1', ['totp', 'email']);
	});

	it('rejects email codes when no email provider is configured', async () => {
		mocks.emailEnabled = false;

		await expect(createCaller().organization.updateTwoFactorMethods({ methods: ['email'] })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		expect(mocks.updateOrganizationTwoFactorMethods).not.toHaveBeenCalled();
	});

	it('only lets admins change the allowed methods', async () => {
		mocks.role = 'user';

		await expect(createCaller().organization.updateTwoFactorMethods({ methods: ['totp'] })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('resets the two-factor authentication of a member', async () => {
		await createCaller().organization.resetMemberTwoFactor({ userId: 'member-1' });

		expect(mocks.resetUserTwoFactor).toHaveBeenCalledWith('member-1');
	});

	it('refuses to reset a user outside the organization', async () => {
		mocks.getUserRoleInOrg.mockResolvedValue(null);

		await expect(createCaller().organization.resetMemberTwoFactor({ userId: 'stranger-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.resetUserTwoFactor).not.toHaveBeenCalled();
	});

	it('refuses to reset a member who also belongs to another organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(createCaller().organization.resetMemberTwoFactor({ userId: 'shared-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.resetUserTwoFactor).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' } },
		selectedProjectId: null,
	} as never);
}
