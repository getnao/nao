import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	role: 'admin',
}));

const mocks = vi.hoisted(() => ({
	getCreditSummary: vi.fn(),
	listCreditLedger: vi.fn(),
	listManagedAiUsage: vi.fn(),
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
	listCreditLedger: mocks.listCreditLedger,
}));

vi.mock('../src/queries/managed-ai-usage.queries', () => ({
	listManagedAiUsage: mocks.listManagedAiUsage,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: vi.fn(async () => ({
		orgId: 'org-id',
		userId: 'user-id',
		role: state.role,
		createdAt: new Date(),
	})),
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
		mocks.listCreditLedger.mockResolvedValue({ groups: [], nextCursor: null });
		mocks.listManagedAiUsage.mockResolvedValue({ runs: [], nextCursor: null });
	});

	it('keeps wallet activity private while returning only the member usage', async () => {
		state.role = 'member';

		await expect(caller().account.getCreditSummary()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(caller().account.listCreditLedger({ limit: 10 })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(caller().account.listManagedAiUsage({ limit: 10 })).resolves.toEqual({
			runs: [],
			nextCursor: null,
		});
		expect(mocks.getCreditSummary).not.toHaveBeenCalled();
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
		await expect(caller().account.listCreditLedger({ limit: 10 })).resolves.toEqual({
			groups: [],
			nextCursor: null,
		});
		await expect(caller().account.listManagedAiUsage({ limit: 10 })).resolves.toEqual({
			runs: [],
			nextCursor: null,
		});
		expect(mocks.listCreditLedger).toHaveBeenCalledWith('org-id', {
			cursor: undefined,
			limit: 10,
		});
		expect(mocks.listManagedAiUsage).toHaveBeenCalledWith({ orgId: 'org-id' }, { cursor: undefined, limit: 10 });
	});
});

function caller() {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
			session: { token: 'session-token' },
		},
		selectedProjectId: 'project-id',
		selectedOrganizationId: 'org-id',
	} as never);
}
