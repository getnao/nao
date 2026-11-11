import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getPeriodCostsByUser, getUserPeriodCost } from '../src/queries/member-budget.queries';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

vi.mock('../src/utils/llm', () => ({
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
			[NAMED_PROVIDER_USER_ID]: 2,
		});
	});

	it('enforces the member budget against named provider spend', async () => {
		await expect(getUserPeriodCost(PROJECT_ID, NAMED_PROVIDER_USER_ID, 'month')).resolves.toBe(2);
	});
});
