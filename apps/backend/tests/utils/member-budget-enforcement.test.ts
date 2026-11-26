import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimGroupBudgetNotification: vi.fn(),
	claimMemberBudgetNotification: vi.fn(),
	getProjectProviderBudgets: vi.fn(),
	notify: vi.fn(),
	resolveGroupSharedBudgetUsages: vi.fn(),
	resolveMemberBudgetUsage: vi.fn(),
}));

vi.mock('../../src/queries/budget.queries', () => ({
	advanceStaleBudgetPeriods: vi.fn(),
	claimBudgetNotification: vi.fn(async () => false),
	getProjectProviderBudgets: mocks.getProjectProviderBudgets,
	getProviderBudgetSpend: vi.fn(async () => ({ projectSpend: 520, userSpend: 520 })),
}));
vi.mock('../../src/queries/member-budget.queries', () => ({
	claimGroupBudgetNotification: mocks.claimGroupBudgetNotification,
	claimMemberBudgetNotification: mocks.claimMemberBudgetNotification,
	releaseGroupBudgetNotification: vi.fn(),
	releaseMemberBudgetNotification: vi.fn(),
}));
vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/services/email', () => ({ emailService: { isEnabled: () => false } }));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => true),
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../../src/services/notification.service', () => ({ notify: mocks.notify }));
vi.mock('../../src/utils/llm', () => ({
	getProjectConfigLlm: vi.fn(async () => null),
	getProjectDeclaredModels: vi.fn(),
}));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));
vi.mock('../../src/utils/member-budget', () => ({
	resolveGroupSharedBudgetUsages: mocks.resolveGroupSharedBudgetUsages,
	resolveMemberBudgetUsage: mocks.resolveMemberBudgetUsage,
}));

import { assertBudgetNotExceeded, checkBudgetStatus } from '../../src/utils/budget';

describe('member budget enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectProviderBudgets.mockResolvedValue([]);
		mocks.resolveGroupSharedBudgetUsages.mockResolvedValue([]);
		mocks.resolveMemberBudgetUsage.mockResolvedValue({
			limitUsd: 100,
			source: 'group',
			spendUsd: 100,
			ratio: 1,
			period: 'month',
			resetsAt: new Date('2026-11-01T00:00:00.000Z'),
		});
	});

	it('blocks a member over budget with a message naming where the limit comes from', async () => {
		mocks.claimMemberBudgetNotification.mockResolvedValue(true);

		await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).rejects.toThrow(
			"You've used 100% of your user group budget for this month.",
		);
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user-id', category: 'budget', channels: ['in_app'] }),
		);
	});

	it('notifies the member only once per period', async () => {
		mocks.claimMemberBudgetNotification.mockResolvedValue(false);

		await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).rejects.toThrow();
		expect(mocks.notify).not.toHaveBeenCalled();
	});

	it.each(['personal', 'group'] as const)('lets a %s budget replace the provider per-user limit', async (source) => {
		mocks.getProjectProviderBudgets.mockResolvedValue([
			{ provider: 'openai', limitUsd: 0, perUserLimitUsd: 500, period: 'month' },
		]);
		mocks.resolveMemberBudgetUsage.mockResolvedValue({
			limitUsd: 700,
			source,
			spendUsd: 520,
			ratio: 520 / 700,
			period: 'month',
			resetsAt: new Date('2026-11-01T00:00:00.000Z'),
		});

		await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).resolves.toBeUndefined();
	});

	it('applies the provider per-user limit when the member only has the default budget', async () => {
		mocks.getProjectProviderBudgets.mockResolvedValue([
			{ provider: 'openai', limitUsd: 0, perUserLimitUsd: 500, period: 'month' },
		]);
		mocks.resolveMemberBudgetUsage.mockResolvedValue({
			limitUsd: 700,
			source: 'default',
			spendUsd: 520,
			ratio: 520 / 700,
			period: 'month',
			resetsAt: new Date('2026-11-01T00:00:00.000Z'),
		});

		await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).rejects.toThrow(
			"You've used 100% of your personal OpenAI budget.",
		);
	});
});

describe('group shared budget enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectProviderBudgets.mockResolvedValue([]);
		mocks.resolveMemberBudgetUsage.mockResolvedValue({
			limitUsd: 500,
			source: 'personal',
			spendUsd: 10,
			ratio: 10 / 500,
			period: 'month',
			resetsAt: new Date('2026-11-01T00:00:00.000Z'),
		});
	});

	it('blocks a member under their own budget once their group used its shared budget, notifying once', async () => {
		mocks.resolveGroupSharedBudgetUsages.mockResolvedValue([groupUsage(1000)]);
		mocks.claimGroupBudgetNotification.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).rejects.toThrow(
				'Your Analysts group has used 100% of its shared budget for this month.',
			);
		}
		expect(mocks.notify).toHaveBeenCalledTimes(1);
		expect(mocks.notify).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user-id', title: 'Analysts shared budget reached' }),
		);
	});

	it('warns a member when their group gets close to its shared budget', async () => {
		mocks.resolveGroupSharedBudgetUsages.mockResolvedValue([groupUsage(850)]);

		await expect(assertBudgetNotExceeded('project-id', 'openai', 'user-id')).resolves.toBeUndefined();
		await expect(checkBudgetStatus('project-id', 'openai', 'user-id')).resolves.toEqual({
			level: 'warning',
			message: expect.stringContaining('Your Analysts group has used 85% of its shared budget'),
		});
	});
});

function groupUsage(spendUsd: number) {
	return {
		groupId: 'analysts',
		groupName: 'Analysts',
		limitUsd: 1000,
		spendUsd,
		ratio: spendUsd / 1000,
		period: 'month',
		resetsAt: new Date('2026-11-01T00:00:00.000Z'),
	};
}
