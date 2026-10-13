import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getPersonalBudget: vi.fn(),
	getMemberBudgetSettings: vi.fn(),
	getUserPeriodCost: vi.fn(),
	hasFeature: vi.fn(),
	listActiveUserGroups: vi.fn(),
	listGroupBudgetsForMember: vi.fn(),
}));

vi.mock('../src/queries/member-budget.queries', () => ({
	getPersonalBudget: mocks.getPersonalBudget,
	getMemberBudgetSettings: mocks.getMemberBudgetSettings,
	getUserPeriodCost: mocks.getUserPeriodCost,
	listGroupBudgetsForMember: mocks.listGroupBudgetsForMember,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	listActiveUserGroups: mocks.listActiveUserGroups,
}));

import { getMemberBudgetLimit, resolveMemberBudgetUsage } from '../src/utils/member-budget';

describe('member budget resolution', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getMemberBudgetSettings.mockResolvedValue({ period: 'month', defaultLimitUsd: 100 });
		mocks.getPersonalBudget.mockResolvedValue(null);
		mocks.listGroupBudgetsForMember.mockResolvedValue([]);
		mocks.listActiveUserGroups.mockResolvedValue([{ id: 'analysts' }]);
		mocks.getUserPeriodCost.mockResolvedValue(90);
	});

	it('keeps the inherited group budget visible under a personal budget', async () => {
		mocks.listGroupBudgetsForMember.mockResolvedValue([{ groupId: 'analysts', limitUsd: 300 }]);
		mocks.getPersonalBudget.mockResolvedValue({ limitUsd: 50 });

		await expect(getMemberBudgetLimit('project-id', 'user-id')).resolves.toMatchObject({
			limitUsd: 50,
			source: 'personal',
			inheritedLimitUsd: 300,
			inheritedSource: 'group',
		});
	});

	it('ignores budgets of user groups locked on the free plan', async () => {
		mocks.listGroupBudgetsForMember.mockResolvedValue([{ groupId: 'locked-group', limitUsd: 1000 }]);

		await expect(getMemberBudgetLimit('project-id', 'user-id')).resolves.toMatchObject({
			limitUsd: 100,
			source: 'default',
		});
	});

	it('reports usage against the resolved budget with its source', async () => {
		await expect(resolveMemberBudgetUsage('project-id', 'user-id')).resolves.toMatchObject({
			limitUsd: 100,
			source: 'default',
			spendUsd: 90,
			ratio: 0.9,
			period: 'month',
		});
		expect(mocks.getUserPeriodCost).toHaveBeenCalledWith('project-id', 'user-id', 'month');
	});

	it('skips usage when no limit applies or the license is missing', async () => {
		mocks.getMemberBudgetSettings.mockResolvedValue({ period: 'month', defaultLimitUsd: 0 });
		await expect(resolveMemberBudgetUsage('project-id', 'user-id')).resolves.toBeNull();

		mocks.hasFeature.mockResolvedValue(false);
		await expect(resolveMemberBudgetUsage('project-id', 'user-id')).resolves.toBeNull();
		expect(mocks.getUserPeriodCost).not.toHaveBeenCalled();
	});
});
