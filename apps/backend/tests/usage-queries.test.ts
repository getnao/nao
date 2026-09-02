import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getMessagesUsage, getTotalUsage } from '../src/queries/usage.queries';
import { formatDate, resolvePeriodAndGranularity } from '../src/utils/date';

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
			'mattermost',
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
			messageCount: 9,
			webMessageCount: 1,
			slackMessageCount: 1,
			teamsMessageCount: 1,
			telegramMessageCount: 1,
			mattermostMessageCount: 1,
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

	it('supports flexible time periods (30d, 60d, 90d, 6m)', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
		try {
			// Insert rows near boundaries:
			// 1. One ms before 6m start boundary (2026-02-28 23:59:59.999 UTC) -> should be excluded
			// 2. Exactly at 6m start boundary (2026-03-01 00:00:00.000 UTC) -> should be included in 2026-03
			// 3. In the current active month (2026-08-28 10:00:00.000 UTC) -> should be included in 2026-08
			await db.insert(s.chatMessage).values([
				{
					id: 'out-of-range-before-6m',
					chatId: CHAT_ID,
					role: 'user',
					createdAt: new Date('2026-02-28T23:59:59.999Z'),
				},
				{
					id: 'exact-boundary-6m',
					chatId: CHAT_ID,
					role: 'user',
					createdAt: new Date('2026-03-01T00:00:00.000Z'),
				},
				{
					id: 'current-month-active',
					chatId: CHAT_ID,
					role: 'user',
					createdAt: new Date('2026-08-28T10:00:00.000Z'),
				},
			]);

			const records30d = await getMessagesUsage(PROJECT_ID, { period: '30d' });
			expect(records30d).toHaveLength(30);
			expect(records30d.find((r) => r.date === '2026-08-28')?.messageCount).toBe(1);
			expect(records30d.reduce((sum, r) => sum + r.messageCount, 0)).toBe(1);

			const records60d = await getMessagesUsage(PROJECT_ID, { period: '60d' });
			expect(records60d).toHaveLength(60);
			expect(records60d.find((r) => r.date === '2026-08-28')?.messageCount).toBe(1);
			expect(records60d.reduce((sum, r) => sum + r.messageCount, 0)).toBe(1);

			const records90d = await getMessagesUsage(PROJECT_ID, { period: '90d' });
			expect(records90d).toHaveLength(90);
			expect(records90d.find((r) => r.date === '2026-08-28')?.messageCount).toBe(1);
			expect(records90d.reduce((sum, r) => sum + r.messageCount, 0)).toBe(1);

			const records6m = await getMessagesUsage(PROJECT_ID, { period: '6m' });
			expect(records6m).toHaveLength(6);
			expect(records6m.map((r) => r.date)).toEqual([
				'2026-03',
				'2026-04',
				'2026-05',
				'2026-06',
				'2026-07',
				'2026-08',
			]);
			expect(records6m.find((r) => r.date === '2026-03')?.messageCount).toBe(1);
			expect(records6m.find((r) => r.date === '2026-08')?.messageCount).toBe(1);
			expect(records6m.find((r) => r.date === '2026-04')?.messageCount).toBe(0);
			expect(records6m.reduce((sum, r) => sum + r.messageCount, 0)).toBe(2);

			// Diverging period and granularity
			const records6mDaily = await getMessagesUsage(PROJECT_ID, { period: '6m', granularity: 'day' });
			expect(records6mDaily).toHaveLength(181);
			expect(records6mDaily[0].date).toBe('2026-03-01');
			expect(records6mDaily[0].messageCount).toBe(1);
			expect(records6mDaily[records6mDaily.length - 1].date).toBe('2026-08-28');
			expect(records6mDaily[records6mDaily.length - 1].messageCount).toBe(1);
			expect(records6mDaily.reduce((sum, r) => sum + r.messageCount, 0)).toBe(2);

			// Verify that advancing past midnight UTC increments the daily bucket count by exactly 1
			const beforeMidnight = new Date('2026-08-28T23:59:59.000Z');
			const afterMidnight = new Date('2026-08-29T00:00:01.000Z');
			const resolvedBefore = resolvePeriodAndGranularity({ period: '6m', granularity: 'day' }, beforeMidnight);
			const resolvedAfter = resolvePeriodAndGranularity({ period: '6m', granularity: 'day' }, afterMidnight);
			expect(resolvedBefore.count).toBe(181);
			expect(resolvedAfter.count).toBe(182);
			expect(resolvedBefore.startDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
			expect(resolvedAfter.startDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
		} finally {
			vi.useRealTimers();
		}
	});
});
