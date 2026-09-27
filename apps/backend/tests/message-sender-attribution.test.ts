import '../src/env';

import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getProviderBudgetSpend, getProviderPeriodCostsByUser } from '../src/queries/budget.queries';
import { getMessagesUsage, getTotalUsage } from '../src/queries/usage.queries';

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

const PROJECT_ID = 'attribution-project';
const OWNER_ID = 'attribution-owner';
const REPLIER_ID = 'attribution-replier';
const CHAT_ID = 'attribution-chat';
const PROVIDER = 'anthropic';
const MODEL = 'claude-sonnet-4-5';
const PERIOD = { value: 15, unit: 'day' } as const;

const assistantTokens = (input: number, output: number) => ({
	llmProvider: PROVIDER,
	llmModelId: MODEL,
	inputTotalTokens: input,
	inputNoCacheTokens: input,
	inputCacheReadTokens: 0,
	inputCacheWriteTokens: 0,
	outputTotalTokens: output,
	outputTextTokens: output,
	outputReasoningTokens: 0,
	totalTokens: input + output,
});

describe('message sender attribution', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: OWNER_ID, name: 'Thread Owner', email: 'owner@example.com' },
			{ id: REPLIER_ID, name: 'Thread Replier', email: 'replier@example.com' },
		]);
		await db.insert(s.project).values({
			id: PROJECT_ID,
			name: 'Attribution Project',
			type: 'local',
			path: '/tmp/attribution-project',
		});
		await db.insert(s.chat).values({ id: CHAT_ID, projectId: PROJECT_ID, userId: OWNER_ID });
	});

	beforeEach(async () => {
		await db.delete(s.chatMessage);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('counts each sender in a shared thread as a distinct user', async () => {
		await db.insert(s.chatMessage).values([
			{ id: 'shared-1', chatId: CHAT_ID, senderUserId: OWNER_ID, role: 'user' },
			{ id: 'shared-2', chatId: CHAT_ID, senderUserId: REPLIER_ID, role: 'user' },
		]);

		await expect(getTotalUsage(PROJECT_ID, { period: PERIOD })).resolves.toEqual({
			totalMessages: 2,
			uniqueUsers: 2,
		});
	});

	it('bills a reply to its sender rather than to the thread owner', async () => {
		await db.insert(s.chatMessage).values([
			{
				id: 'cost-owner',
				chatId: CHAT_ID,
				senderUserId: OWNER_ID,
				role: 'assistant',
				...assistantTokens(1_000, 200),
			},
			{
				id: 'cost-replier',
				chatId: CHAT_ID,
				senderUserId: REPLIER_ID,
				role: 'assistant',
				...assistantTokens(400_000, 20_000),
			},
		]);

		const costs = await getProviderPeriodCostsByUser(PROJECT_ID, [{ provider: PROVIDER, period: 'month' }]);

		expect(costs[PROVIDER][REPLIER_ID]).toBeGreaterThan(costs[PROVIDER][OWNER_ID]);
	});

	it('reports per-user budget spend for the replier, not only for the owner', async () => {
		await db.insert(s.chatMessage).values({
			id: 'spend-replier',
			chatId: CHAT_ID,
			senderUserId: REPLIER_ID,
			role: 'assistant',
			...assistantTokens(400_000, 20_000),
		});

		const ownerSpend = await getProviderBudgetSpend(PROJECT_ID, PROVIDER, 'month', OWNER_ID);
		const replierSpend = await getProviderBudgetSpend(PROJECT_ID, PROVIDER, 'month', REPLIER_ID);

		expect(replierSpend.userSpend).toBeGreaterThan(0);
		expect(ownerSpend.userSpend).toBe(0);
		expect(ownerSpend.projectSpend).toBe(replierSpend.projectSpend);
	});

	it('resolves the user name filter through the sender', async () => {
		await db.insert(s.chatMessage).values([
			{ id: 'filter-owner', chatId: CHAT_ID, senderUserId: OWNER_ID, role: 'user' },
			{ id: 'filter-replier-1', chatId: CHAT_ID, senderUserId: REPLIER_ID, role: 'user' },
			{ id: 'filter-replier-2', chatId: CHAT_ID, senderUserId: REPLIER_ID, role: 'user' },
		]);

		const filtered = await getTotalUsage(PROJECT_ID, { period: PERIOD, userNames: ['Thread Replier'] });

		expect(filtered.totalMessages).toBe(2);
	});

	it('falls back to the chat owner for rows written before the column existed', async () => {
		await db.insert(s.chatMessage).values([
			{ id: 'legacy-user', chatId: CHAT_ID, role: 'user' },
			{ id: 'legacy-assistant', chatId: CHAT_ID, role: 'assistant', ...assistantTokens(400_000, 20_000) },
		]);
		const legacyRows = await db
			.select({ id: s.chatMessage.id })
			.from(s.chatMessage)
			.where(isNull(s.chatMessage.senderUserId));
		expect(legacyRows).toHaveLength(2);

		const [totals, costs] = await Promise.all([
			getTotalUsage(PROJECT_ID, { period: PERIOD }),
			getProviderPeriodCostsByUser(PROJECT_ID, [{ provider: PROVIDER, period: 'month' }]),
		]);

		expect(totals).toEqual({ totalMessages: 1, uniqueUsers: 1 });
		expect(costs[PROVIDER][OWNER_ID]).toBeGreaterThan(0);
		expect(costs[PROVIDER][REPLIER_ID]).toBeUndefined();
	});

	it('keeps the chart query consistent with the totals', async () => {
		await db.insert(s.chatMessage).values([
			{ id: 'chart-owner', chatId: CHAT_ID, senderUserId: OWNER_ID, role: 'user' },
			{ id: 'chart-replier', chatId: CHAT_ID, senderUserId: REPLIER_ID, role: 'user' },
		]);

		const [records, totals] = await Promise.all([
			getMessagesUsage(PROJECT_ID, { period: PERIOD }),
			getTotalUsage(PROJECT_ID, { period: PERIOD }),
		]);

		const charted = records.reduce((sum, record) => sum + record.messageCount, 0);
		expect(charted).toBe(totals.totalMessages);
	});

	it('nulls the sender when the user is deleted instead of orphaning the row', async () => {
		await db.insert(s.user).values({ id: 'deletable-sender', name: 'Deletable', email: 'deletable@example.com' });
		await db.insert(s.chatMessage).values({
			id: 'delete-sender',
			chatId: CHAT_ID,
			senderUserId: 'deletable-sender',
			role: 'user',
		});

		await db.delete(s.user).where(eq(s.user.id, 'deletable-sender'));

		const [row] = await db
			.select({ senderUserId: s.chatMessage.senderUserId })
			.from(s.chatMessage)
			.where(eq(s.chatMessage.id, 'delete-sender'));
		expect(row.senderUserId).toBeNull();
	});
});
