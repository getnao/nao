import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getPersonalBudget: vi.fn(),
	getMemberBudgetSettings: vi.fn(),
	getPeriodCostsByUser: vi.fn(),
	getUserPeriodCost: vi.fn(),
	hasFeature: vi.fn(),
	listActiveUserGroups: vi.fn(),
	listGroupBudgetsForMember: vi.fn(),
	listGroupMemberships: vi.fn(),
	listGroupSharedBudgetsForMember: vi.fn(),
}));

vi.mock('../../src/queries/member-budget.queries', () => ({
	getPersonalBudget: mocks.getPersonalBudget,
	getMemberBudgetSettings: mocks.getMemberBudgetSettings,
	getPeriodCostsByUser: mocks.getPeriodCostsByUser,
	getUserPeriodCost: mocks.getUserPeriodCost,
	listGroupBudgetsForMember: mocks.listGroupBudgetsForMember,
	listGroupMemberships: mocks.listGroupMemberships,
	listGroupSharedBudgetsForMember: mocks.listGroupSharedBudgetsForMember,
}));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../../src/services/user-group-availability.service', () => ({
	listActiveUserGroups: mocks.listActiveUserGroups,
}));

import {
	getMemberBudgetLimit,
	resolveGroupSharedBudgetUsages,
	resolveMemberBudgetUsage,
} from '../../src/utils/member-budget';

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

	it('reports usage without warning when no limit applies', async () => {
		mocks.getMemberBudgetSettings.mockResolvedValue({ period: 'month', defaultLimitUsd: 0 });
		await expect(resolveMemberBudgetUsage('project-id', 'user-id')).resolves.toMatchObject({
			limitUsd: 0,
			source: 'default',
			spendUsd: 90,
			ratio: 0,
			period: 'month',
		});
		expect(mocks.getUserPeriodCost).toHaveBeenCalledWith('project-id', 'user-id', 'month');
	});

	it('skips usage when the license is missing', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		await expect(resolveMemberBudgetUsage('project-id', 'user-id')).resolves.toBeNull();
		expect(mocks.hasFeature).toHaveBeenCalledWith('user-budget', { projectId: 'project-id' });
		expect(mocks.getUserPeriodCost).not.toHaveBeenCalled();
	});
});

describe('group shared budget resolution', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getMemberBudgetSettings.mockResolvedValue({ period: 'month', defaultLimitUsd: 100 });
		mocks.listActiveUserGroups.mockResolvedValue([{ id: 'analysts' }]);
		mocks.getPeriodCostsByUser.mockResolvedValue({ 'user-id': 120, teammate: 300.5, outsider: 999 });
	});

	it('sums the spend of every group member once, even when added by hand and by SSO', async () => {
		mocks.listGroupSharedBudgetsForMember.mockResolvedValue([
			{ groupId: 'analysts', groupName: 'Analysts', limitUsd: 500 },
		]);
		mocks.listGroupMemberships.mockResolvedValue([
			{ groupId: 'analysts', userId: 'user-id' },
			{ groupId: 'analysts', userId: 'teammate' },
			{ groupId: 'analysts', userId: 'teammate' },
		]);

		await expect(resolveGroupSharedBudgetUsages('project-id', 'user-id')).resolves.toEqual([
			expect.objectContaining({
				groupId: 'analysts',
				groupName: 'Analysts',
				spendUsd: 420.5,
				ratio: 420.5 / 500,
			}),
		]);
		expect(mocks.getPeriodCostsByUser).toHaveBeenCalledWith('project-id', 'month', ['user-id', 'teammate']);
	});

	it('ignores shared budgets of user groups locked on the free plan', async () => {
		mocks.listGroupSharedBudgetsForMember.mockResolvedValue([
			{ groupId: 'locked-group', groupName: 'Locked', limitUsd: 500 },
		]);

		await expect(resolveGroupSharedBudgetUsages('project-id', 'user-id')).resolves.toEqual([]);
		expect(mocks.getPeriodCostsByUser).not.toHaveBeenCalled();
	});
});
