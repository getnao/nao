import '../../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	getPeriodCostsByUser,
	getUserPeriodCost,
	listGroupBudgetsForMember,
	listGroupSharedBudgetsForMember,
	setGroupSharedBudget,
} from '../../src/queries/member-budget.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

vi.mock('../../src/utils/llm', () => ({
	getProjectAvailableModels: async () => [],
	getProjectDeclaredModels: async () => [
		{
			provider: 'openaiCompatible/litellm',
			models: [{ id: 'gpt-5', costPerM: { inputNoCache: 1, output: 1 } }],
		},
	],
}));

const PROJECT_ID = 'member-budget-project';
const BUILT_IN_USER_ID = 'member-budget-built-in-user';
const NAMED_PROVIDER_USER_ID = 'member-budget-named-provider-user';

describe('member budget spend', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: BUILT_IN_USER_ID, name: 'Built-in User', email: 'built-in@example.com' },
			{ id: NAMED_PROVIDER_USER_ID, name: 'Named Provider User', email: 'named-provider@example.com' },
		]);
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, name: 'Member Budget Project', type: 'local', path: '/tmp/member-budget' });
		await db.insert(s.chat).values([
			{ id: 'built-in-chat', projectId: PROJECT_ID, userId: BUILT_IN_USER_ID },
			{ id: 'named-provider-chat', projectId: PROJECT_ID, userId: NAMED_PROVIDER_USER_ID },
		]);
		await db.insert(s.chatMessage).values([
			{
				id: 'built-in-message',
				chatId: 'built-in-chat',
				role: 'assistant',
				llmProvider: 'anthropic',
				llmModelId: 'claude-haiku-4-5',
				inputNoCacheTokens: 1_000_000,
				outputTotalTokens: 1_000_000,
			},
			{
				id: 'named-provider-message',
				chatId: 'named-provider-chat',
				role: 'assistant',
				llmProvider: 'openaiCompatible/litellm',
				llmModelId: 'gpt-5',
				inputNoCacheTokens: 1_000_000,
				outputTotalTokens: 1_000_000,
			},
			{
				id: 'named-provider-sub-cent-message',
				chatId: 'named-provider-chat',
				role: 'assistant',
				llmProvider: 'openaiCompatible/litellm',
				llmModelId: 'gpt-5',
				inputNoCacheTokens: 1_000,
				outputTotalTokens: 0,
			},
			{
				id: 'named-provider-message-last-year',
				chatId: 'named-provider-chat',
				role: 'assistant',
				llmProvider: 'openaiCompatible/litellm',
				llmModelId: 'gpt-5',
				inputNoCacheTokens: 1_000_000,
				outputTotalTokens: 1_000_000,
				createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
			},
		]);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('counts spend on named providers alongside built-in ones', async () => {
		await expect(getPeriodCostsByUser(PROJECT_ID, 'month')).resolves.toEqual({
			[BUILT_IN_USER_ID]: 6,
			[NAMED_PROVIDER_USER_ID]: 2.001,
		});
	});

	it('only sums the spend of the requested members, keeping sub-cent costs for group totals', async () => {
		await expect(getPeriodCostsByUser(PROJECT_ID, 'month', [NAMED_PROVIDER_USER_ID])).resolves.toEqual({
			[NAMED_PROVIDER_USER_ID]: 2.001,
		});
	});

	it('enforces the member budget against named provider spend', async () => {
		await expect(getUserPeriodCost(PROJECT_ID, NAMED_PROVIDER_USER_ID, 'month')).resolves.toBe(2);
	});

	it('ignores inactive memberships and archived groups when resolving group budgets', async () => {
		await db.insert(s.userGroup).values({ id: 'budget-group', projectId: PROJECT_ID, name: 'Budget Group' });
		await db.insert(s.userGroupMember).values({ groupId: 'budget-group', userId: BUILT_IN_USER_ID });
		await db
			.insert(s.projectGroupBudget)
			.values({ projectId: PROJECT_ID, groupId: 'budget-group', limitUsd: 100, active: true });

		await expect(listGroupBudgetsForMember(PROJECT_ID, BUILT_IN_USER_ID)).resolves.toEqual([
			{ groupId: 'budget-group', limitUsd: 100 },
		]);

		await db.update(s.userGroupMember).set({ active: false }).where(eq(s.userGroupMember.groupId, 'budget-group'));
		await expect(listGroupBudgetsForMember(PROJECT_ID, BUILT_IN_USER_ID)).resolves.toEqual([]);

		await db.update(s.userGroupMember).set({ active: true }).where(eq(s.userGroupMember.groupId, 'budget-group'));
		await db
			.update(s.userGroup)
			.set({ archivedAt: new Date(), archivedName: 'Budget Group', name: '__archived__budget-group' })
			.where(eq(s.userGroup.id, 'budget-group'));
		await expect(listGroupBudgetsForMember(PROJECT_ID, BUILT_IN_USER_ID)).resolves.toEqual([]);
	});

	it('finds the shared budget of a member synced from SSO, and drops it once set to 0', async () => {
		await db.insert(s.userGroup).values({ id: 'analysts', projectId: PROJECT_ID, name: 'Analysts' });
		await db.insert(s.userGroupMember).values([
			{ groupId: 'analysts', userId: BUILT_IN_USER_ID, provider: 'manual' },
			{ groupId: 'analysts', userId: BUILT_IN_USER_ID, provider: 'oidc' },
		]);
		await setGroupSharedBudget(PROJECT_ID, 'analysts', 500);

		await expect(listGroupSharedBudgetsForMember(PROJECT_ID, BUILT_IN_USER_ID)).resolves.toEqual([
			{ groupId: 'analysts', groupName: 'Analysts', isDefault: false, limitUsd: 500 },
		]);

		await setGroupSharedBudget(PROJECT_ID, 'analysts', 0);

		await expect(listGroupSharedBudgetsForMember(PROJECT_ID, BUILT_IN_USER_ID)).resolves.toEqual([]);
	});

	it('applies the shared budget of All Users to a member without group rows', async () => {
		await db
			.insert(s.userGroup)
			.values({ id: 'everyone', projectId: PROJECT_ID, name: 'All Users', isDefault: true });
		await setGroupSharedBudget(PROJECT_ID, 'everyone', 2000);

		await expect(listGroupSharedBudgetsForMember(PROJECT_ID, NAMED_PROVIDER_USER_ID)).resolves.toEqual([
			{ groupId: 'everyone', groupName: 'All Users', isDefault: true, limitUsd: 2000 },
		]);
	});
});
