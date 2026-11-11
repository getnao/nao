import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	role: 'admin',
}));

const mocks = vi.hoisted(() => ({
	getCreditSummary: vi.fn(),
	getOrganizationSetupCreditGrant: vi.fn(),
	listCreditLedger: vi.fn(),
	listManagedAiUsage: vi.fn(),
	getUserOrgMembership: vi.fn(),
	getUserOrgMembershipByProject: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getSession: vi.fn(async () => null),
}));

vi.mock('../src/agents/managed-ai', () => ({
	isManagedAiEnabled: vi.fn(() => true),
}));

vi.mock('../src/queries/account.queries', () => ({}));

vi.mock('../src/queries/credit-wallet.queries', () => ({
	getCreditSummary: mocks.getCreditSummary,
	getOrganizationSetupCreditGrant: mocks.getOrganizationSetupCreditGrant,
	listCreditLedger: mocks.listCreditLedger,
}));

vi.mock('../src/queries/managed-ai-usage.queries', () => ({
	listManagedAiUsage: mocks.listManagedAiUsage,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
	getUserOrgMembershipByProject: mocks.getUserOrgMembershipByProject,
}));

vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/services/credit-wallet.service', () => ({}));
vi.mock('../src/services/email', () => ({ emailService: { sendEmail: vi.fn() } }));

import { accountRoutes } from '../src/trpc/account.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ account: accountRoutes });

describe('account wallet activity authorization', () => {
	beforeEach(() => {
		state.role = 'admin';
		vi.clearAllMocks();
		mocks.getCreditSummary.mockResolvedValue({
			balanceMicroUsd: 20_000_000,
			lifetimeCreditedMicroUsd: 25_000_000,
			lifetimeDebitedMicroUsd: 5_000_000,
		});
		mocks.getOrganizationSetupCreditGrant.mockResolvedValue({
			id: 'setup-grant-id',
			amountMicroUsd: 20_000_000,
		});
		mocks.listCreditLedger.mockResolvedValue({ groups: [], nextCursor: null, totalCount: 0 });
		mocks.listManagedAiUsage.mockResolvedValue({ runs: [], nextCursor: null, totalCount: 0 });
		mocks.getUserOrgMembership.mockImplementation(async () => ({
			orgId: 'org-id',
			userId: 'user-id',
			role: state.role,
			createdAt: new Date(),
		}));
		mocks.getUserOrgMembershipByProject.mockImplementation(async () => ({
			orgId: 'project-org-id',
			userId: 'user-id',
			role: state.role,
			createdAt: new Date(),
		}));
	});

	it('keeps wallet activity private while returning only the member usage', async () => {
		state.role = 'member';

		await expect(caller().account.getCreditSummary()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(caller().account.listCreditLedger({ limit: 10 })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(caller().account.getOrganizationSetupCreditGrant()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(caller().account.listManagedAiUsage({ limit: 10 })).resolves.toEqual({
			runs: [],
			nextCursor: null,
			totalCount: 0,
		});
		expect(mocks.getCreditSummary).not.toHaveBeenCalled();
		expect(mocks.getOrganizationSetupCreditGrant).not.toHaveBeenCalled();
		expect(mocks.listCreditLedger).not.toHaveBeenCalled();
		expect(mocks.listManagedAiUsage).toHaveBeenCalledWith(
			{ orgId: 'org-id', userId: 'user-id' },
			{ cursor: undefined, limit: 10 },
		);
	});

	it('returns organization-wide activity to organization admins', async () => {
		await expect(caller().account.getCreditSummary()).resolves.toMatchObject({
			balanceMicroUsd: 20_000_000,
		});
		await expect(caller().account.getOrganizationSetupCreditGrant()).resolves.toEqual({
			id: 'setup-grant-id',
			amountMicroUsd: 20_000_000,
		});
		await expect(caller().account.listCreditLedger({ limit: 10 })).resolves.toEqual({
			groups: [],
			nextCursor: null,
			totalCount: 0,
		});
		await expect(caller().account.listManagedAiUsage({ limit: 10 })).resolves.toEqual({
			runs: [],
			nextCursor: null,
			totalCount: 0,
		});
		expect(mocks.listCreditLedger).toHaveBeenCalledWith('org-id', {
			cursor: undefined,
			limit: 10,
		});
		expect(mocks.listManagedAiUsage).toHaveBeenCalledWith({ orgId: 'org-id' }, { cursor: undefined, limit: 10 });
	});

	it('uses the selected project organization when a different organization is selected', async () => {
		await caller('project-id', 'org-id').account.getCreditSummary();

		expect(mocks.getUserOrgMembershipByProject).toHaveBeenCalledWith('user-id', 'project-id');
		expect(mocks.getCreditSummary).toHaveBeenCalledWith('project-org-id');
		expect(mocks.getUserOrgMembership).not.toHaveBeenCalled();
	});
});

function caller(selectedProjectId: string | null = null, selectedOrganizationId: string | null = 'org-id') {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
			session: { token: 'session-token' },
		},
		selectedProjectId,
		selectedOrganizationId,
	} as never);
}
