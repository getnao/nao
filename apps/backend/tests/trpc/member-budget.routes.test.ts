import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	getMemberBudget: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	setPersonalBudget: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../../src/services/member-budget.service', () => ({
	getMemberBudget: mocks.getMemberBudget,
	getMemberBudgetOverview: vi.fn(),
	getMemberBudgetSettings: vi.fn(),
	getMemberSpendForPeriod: vi.fn(),
	saveMemberBudgets: vi.fn(),
	setPersonalBudget: mocks.setPersonalBudget,
}));

import { memberBudgetRoutes } from '../../src/trpc/member-budget.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router(memberBudgetRoutes);
const caller = createTestCaller(testRouter);

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

		await expect(caller.setPersonalBudget({ userId: 'member-id', limitUsd: 100 })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.setPersonalBudget).not.toHaveBeenCalled();
	});

	it('refuses to read or write the budget of a user outside the project', async () => {
		await expect(caller.getForMember({ userId: 'outsider-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		await expect(caller.setPersonalBudget({ userId: 'outsider-id', limitUsd: 100 })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.getMemberBudget).not.toHaveBeenCalled();
		expect(mocks.setPersonalBudget).not.toHaveBeenCalled();
	});
});
