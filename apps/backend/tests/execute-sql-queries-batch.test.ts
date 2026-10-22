import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getLatestSqlQueriesByChats } from '../src/queries/execute-sql.queries';

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

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

const CHAT_IDS = ['batch-chat-a', 'batch-chat-b', 'batch-chat-c'];
const QUERIES_PER_CHAT = 400;

describe('getLatestSqlQueriesByChats', () => {
	beforeAll(seedQueries);

	afterAll(() => {
		db.$client.close();
	});

	it('looks up more query ids than SQLite accepts in one expression', async () => {
		const queryIdsByChat = new Map(CHAT_IDS.map((chatId) => [chatId, new Set(queryIdsOf(chatId))]));

		const queriesByChat = await getLatestSqlQueriesByChats(queryIdsByChat);

		for (const chatId of CHAT_IDS) {
			expect(Object.keys(queriesByChat.get(chatId) ?? {})).toHaveLength(QUERIES_PER_CHAT);
		}
		expect(queriesByChat.get('batch-chat-b')?.['batch-chat-b-q7']).toMatchObject({
			sqlQuery: 'select 7 from batch-chat-b',
			adminMode: false,
		});
	});

	it('only returns the queries asked for each chat', async () => {
		const queriesByChat = await getLatestSqlQueriesByChats(
			new Map([
				['batch-chat-a', new Set(['batch-chat-a-q1', 'batch-chat-b-q1'])],
				['batch-chat-b', new Set(['batch-chat-b-q2'])],
			]),
		);

		expect(Object.keys(queriesByChat.get('batch-chat-a') ?? {})).toEqual(['batch-chat-a-q1']);
		expect(Object.keys(queriesByChat.get('batch-chat-b') ?? {})).toEqual(['batch-chat-b-q2']);
	});
});

function queryIdsOf(chatId: string): string[] {
	return Array.from({ length: QUERIES_PER_CHAT }, (_, index) => `${chatId}-q${index}`);
}

async function seedQueries() {
	await db.insert(s.user).values({ id: 'batch-user', name: 'User', email: 'batch-user@example.com' });
	await db.insert(s.project).values({ id: 'batch-project', name: 'Batch', type: 'local', path: '/tmp/batch' });
	for (const chatId of CHAT_IDS) {
		await db.insert(s.chat).values({ id: chatId, userId: 'batch-user', projectId: 'batch-project' });
		const messageId = `${chatId}-message`;
		await db.insert(s.chatMessage).values({ id: messageId, chatId, role: 'assistant' });
		await db.insert(s.messagePart).values(
			queryIdsOf(chatId).map(
				(queryId, index) =>
					({
						messageId,
						order: index,
						type: 'tool-execute_sql',
						toolName: 'execute_sql',
						toolCallId: `${queryId}-call`,
						toolState: 'output-available',
						toolInput: { sql_query: `select ${index} from ${chatId}` },
						toolOutput: { id: queryId },
					}) as typeof s.messagePart.$inferInsert,
			),
		);
	}
}
