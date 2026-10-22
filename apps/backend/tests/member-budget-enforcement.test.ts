import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimMemberBudgetNotification: vi.fn(),
	getProjectProviderBudgets: vi.fn(),
	notify: vi.fn(),
	resolveMemberBudgetUsage: vi.fn(),
}));

vi.mock('../src/queries/budget.queries', () => ({
	advanceStaleBudgetPeriods: vi.fn(),
	claimBudgetNotification: vi.fn(async () => false),
	getProjectProviderBudgets: mocks.getProjectProviderBudgets,
	getProviderBudgetSpend: vi.fn(async () => ({ projectSpend: 520, userSpend: 520 })),
}));
vi.mock('../src/queries/member-budget.queries', () => ({
	claimMemberBudgetNotification: mocks.claimMemberBudgetNotification,
	releaseMemberBudgetNotification: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/services/email', () => ({ emailService: { isEnabled: () => false } }));
vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => true),
	LICENSE_FEATURES: { userBudget: 'user-budget' },
}));
vi.mock('../src/services/notification.service', () => ({ notify: mocks.notify }));
vi.mock('../src/utils/llm', () => ({
	getProjectConfigLlm: vi.fn(async () => null),
	getProjectDeclaredModels: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../src/utils/member-budget', () => ({ resolveMemberBudgetUsage: mocks.resolveMemberBudgetUsage }));

import { assertBudgetNotExceeded } from '../src/utils/budget';

describe('member budget enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectProviderBudgets.mockResolvedValue([]);
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
