import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	role: 'admin' as 'admin' | 'user',
	emailEnabled: true,
	storedMethods: ['totp', 'email'] as string[],
	required: false,
	memberPolicies: [['totp', 'email']] as string[][],
	updateOrganizationTwoFactorRequirement: vi.fn(),
	restartMemberTwoFactorGracePeriod: vi.fn(),
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
	listOrgMembersWithUsers: vi.fn(async () => [
		{ id: 'member-1', name: 'Member', email: 'member@example.com', role: 'user', twoFactorEnabled: true },
	]),
}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/queries/usage.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../src/queries/two-factor.queries', () => ({
	getOrganizationTwoFactorMethods: vi.fn(async () => mocks.storedMethods),
	updateOrganizationTwoFactorMethods: mocks.updateOrganizationTwoFactorMethods,
	resetUserTwoFactor: mocks.resetUserTwoFactor,
	getOrganizationTwoFactorRequirement: vi.fn(async () => ({ required: mocks.required, gracePeriodDays: 7 })),
	updateOrganizationTwoFactorRequirement: mocks.updateOrganizationTwoFactorRequirement,
	restartMemberTwoFactorGracePeriod: mocks.restartMemberTwoFactorGracePeriod,
	listOrgMembersOrganizationsTwoFactorMethods: vi.fn(async () => new Map([['member-1', mocks.memberPolicies]])),
	listOrgMembersTwoFactorGracePeriods: vi.fn(async () => [
		{
			userId: 'member-1',
			requiredAt: new Date('2026-01-01T00:00:00Z'),
			memberSince: new Date('2025-06-01T00:00:00Z'),
			graceRestartedAt: null,
			gracePeriodDays: 7,
		},
	]),
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
		mocks.storedMethods = ['totp', 'email'];
		mocks.required = false;
		mocks.memberPolicies = [['totp', 'email']];
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
		mocks.storedMethods = ['totp'];

		await expect(createCaller().organization.updateTwoFactorMethods({ methods: ['email'] })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		expect(mocks.updateOrganizationTwoFactorMethods).not.toHaveBeenCalled();
	});

	it('keeps already allowed email codes while no email provider is configured', async () => {
		mocks.emailEnabled = false;

		const result = await createCaller().organization.updateTwoFactorMethods({ methods: ['email'] });

		expect(result.methods).toEqual(['email']);
		expect(mocks.updateOrganizationTwoFactorMethods).toHaveBeenCalledWith('org-1', ['email']);
	});

	it('only shows the two-factor status of members to admins', async () => {
		const [adminView] = await createCaller().organization.getMembers();
		mocks.role = 'user';
		const [memberView] = await createCaller().organization.getMembers();

		expect(adminView.twoFactorEnabled).toBe(true);
		expect(adminView.twoFactorDeadline).toEqual(new Date('2026-01-08T00:00:00Z'));
		expect(memberView.twoFactorEnabled).toBeUndefined();
		expect(memberView.twoFactorDeadline).toBeUndefined();
	});

	it('shows no deadline for members who cannot set up any allowed method', async () => {
		mocks.memberPolicies = [['totp'], ['email']];

		const [member] = await createCaller().organization.getMembers();

		expect(member.twoFactorDeadline).toBeNull();
	});

	it('requires two-factor authentication with a grace period', async () => {
		await createCaller().organization.updateTwoFactorRequirement({ required: true, gracePeriodDays: 14 });

		expect(mocks.updateOrganizationTwoFactorRequirement).toHaveBeenCalledWith('org-1', {
			required: true,
			gracePeriodDays: 14,
		});
	});

	it('refuses to require two-factor authentication when members cannot set up any method', async () => {
		mocks.emailEnabled = false;
		mocks.storedMethods = ['email'];

		await expect(
			createCaller().organization.updateTwoFactorRequirement({ required: true, gracePeriodDays: 7 }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateOrganizationTwoFactorRequirement).not.toHaveBeenCalled();
	});

	it('refuses to remove every method while two-factor authentication is required', async () => {
		mocks.required = true;

		await expect(createCaller().organization.updateTwoFactorMethods({ methods: [] })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		expect(mocks.updateOrganizationTwoFactorMethods).not.toHaveBeenCalled();
	});

	it('only lets admins require two-factor authentication', async () => {
		mocks.role = 'user';

		await expect(
			createCaller().organization.updateTwoFactorRequirement({ required: true, gracePeriodDays: 7 }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('restarts the grace period of a member', async () => {
		await createCaller().organization.restartMemberTwoFactorGracePeriod({ userId: 'member-1' });

		expect(mocks.restartMemberTwoFactorGracePeriod).toHaveBeenCalledWith('org-1', 'member-1');
	});

	it('refuses to restart the grace period of a user outside the organization', async () => {
		mocks.getUserRoleInOrg.mockResolvedValue(null);

		await expect(
			createCaller().organization.restartMemberTwoFactorGracePeriod({ userId: 'stranger-1' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.restartMemberTwoFactorGracePeriod).not.toHaveBeenCalled();
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
