import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getMessagesUsage, getTotalUsage } from '../src/queries/usage.queries';
import { formatDate } from '../src/utils/date';

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

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: async () => [],
}));

const PROJECT_ID = 'usage-project';
const USER_ID = 'usage-user';
const CHAT_ID = 'usage-chat';

describe('usage query results', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: USER_ID, name: 'Usage User', email: 'usage@example.com' });
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, name: 'Usage Project', type: 'local', path: '/tmp/usage-project' });
		await db.insert(s.chat).values({ id: CHAT_ID, projectId: PROJECT_ID, userId: USER_ID });
	});

	beforeEach(async () => {
		await db.delete(s.llmInference);
		await db.delete(s.chatMessage);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('returns total usage aggregates as numbers', async () => {
		await db.insert(s.chatMessage).values([
			{ id: 'total-1', chatId: CHAT_ID, role: 'user' },
			{ id: 'total-2', chatId: CHAT_ID, role: 'user' },
		]);

		await expect(getTotalUsage(PROJECT_ID, { granularity: 'day' })).resolves.toEqual({
			totalMessages: 2,
			uniqueUsers: 1,
		});
	});

	it('counts messages by source, including context recommendations', async () => {
		const sources = [
			'web',
			'slack',
			'teams',
			'telegram',
			'whatsapp',
			'admin',
			'mcp',
			'contextRecommendations',
		] as const;
		const now = new Date();
		await db.insert(s.chatMessage).values(
			sources.map((source, index) => ({
				id: `source-${index}`,
				chatId: CHAT_ID,
				role: 'user' as const,
				source,
				createdAt: now,
			})),
		);

		const records = await getMessagesUsage(PROJECT_ID, { granularity: 'day' });
		const record = records.find((item) => item.date === formatDate(now, 'day'));

		expect(record).toMatchObject({
			messageCount: 8,
			webMessageCount: 1,
			slackMessageCount: 1,
			teamsMessageCount: 1,
			telegramMessageCount: 1,
			whatsappMessageCount: 1,
			adminMessageCount: 1,
			mcpMessageCount: 1,
			contextRecommendationsMessageCount: 1,
		});
	});

	it('unions auxiliary inference usage with message usage across dates', async () => {
		const now = new Date();
		const previousDay = new Date(now);
		previousDay.setUTCDate(previousDay.getUTCDate() - 1);

		await db.insert(s.chatMessage).values([
			{
				id: 'union-user',
				chatId: CHAT_ID,
				role: 'user',
				source: 'web',
				createdAt: new Date(now.getTime() - 1_000),
			},
			{
				id: 'union-assistant',
				chatId: CHAT_ID,
				role: 'assistant',
				llmProvider: 'openai',
				llmModelId: 'gpt-4o',
				inputNoCacheTokens: 100,
				inputCacheReadTokens: 10,
				outputTotalTokens: 50,
				totalTokens: 160,
				createdAt: now,
			},
		]);
		await db.insert(s.llmInference).values([
			{
				id: 'union-inference-current',
				projectId: PROJECT_ID,
				userId: USER_ID,
				chatId: CHAT_ID,
				type: 'title_generation',
				llmProvider: 'openai',
				llmModelId: 'gpt-4o',
				inputNoCacheTokens: 30,
				inputCacheReadTokens: 10,
				outputTotalTokens: 10,
				totalTokens: 50,
				createdAt: now,
			},
			{
				id: 'union-inference-previous',
				projectId: PROJECT_ID,
				userId: USER_ID,
				type: 'compaction',
				llmProvider: 'openai',
				llmModelId: 'gpt-4o',
				inputNoCacheTokens: 40,
				outputTotalTokens: 5,
				totalTokens: 45,
				createdAt: previousDay,
			},
		]);

		const records = await getMessagesUsage(PROJECT_ID, { granularity: 'day' });

		expect(records.find((item) => item.date === formatDate(now, 'day'))).toMatchObject({
			messageCount: 1,
			webMessageCount: 1,
			inputNoCacheTokens: 130,
			inputCacheReadTokens: 20,
			outputTotalTokens: 60,
			totalTokens: 210,
		});
		expect(records.find((item) => item.date === formatDate(previousDay, 'day'))).toMatchObject({
			messageCount: 0,
			inputNoCacheTokens: 40,
			outputTotalTokens: 5,
			totalTokens: 45,
		});
	});
});
