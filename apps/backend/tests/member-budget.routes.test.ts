import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getMemberBudget: vi.fn(),
	getMemberBudgetReport: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	setPersonalBudget: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../src/services/member-budget.service', () => ({
	getMemberBudget: mocks.getMemberBudget,
	getMemberBudgetOverview: vi.fn(),
	getMemberBudgetSettings: vi.fn(),
	getMemberSpendForPeriod: vi.fn(),
	saveMemberBudgets: vi.fn(),
	setPersonalBudget: mocks.setPersonalBudget,
}));
vi.mock('../src/services/member-budget-report.service', () => ({
	buildMemberBudgetReportCsv: vi.fn(() => 'Member,Email'),
	getMemberBudgetReport: mocks.getMemberBudgetReport,
}));

import { memberBudgetRoutes } from '../src/trpc/member-budget.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(memberBudgetRoutes);

describe('member budget routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'outsider-id' ? null : 'admin',
		);
	});

	it('rejects member budget changes without the enterprise license', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().setPersonalBudget({ userId: 'member-id', limitUsd: 100 })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.setPersonalBudget).not.toHaveBeenCalled();
	});

	it('exports the usage CSV only with the enterprise license', async () => {
		await expect(createCaller().exportUsageCsv()).resolves.toBe('Member,Email');

		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().exportUsageCsv()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.getMemberBudgetReport).toHaveBeenCalledTimes(1);
	});

	it('refuses to read or write the budget of a user outside the project', async () => {
		await expect(createCaller().getForMember({ userId: 'outsider-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		await expect(createCaller().setPersonalBudget({ userId: 'outsider-id', limitUsd: 100 })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.getMemberBudget).not.toHaveBeenCalled();
		expect(mocks.setPersonalBudget).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
