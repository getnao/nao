import '../../src/env';

import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { listStoryQueries, upsertStoryQueries } from '../../src/queries/story-query.queries';
import { copyMcpQueriesToStory, copyStoryQueries, loadStorySqlQueries } from '../../src/services/story-sql-queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const USER_ID = 'story-sql-user';
const PROJECT_ID = 'story-sql-project';
const CHAT_ID = 'story-sql-chat';
const SOURCE_ID = 'story-sql-source';
const COPY_ID = 'story-sql-copy';
const ATTACHED_ID = 'story-sql-attached';
const MCP_STORY_ID = 'story-sql-mcp';

describe('story SQL queries', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('copies the chat queries a story reads, and the queries they read from, but no other', async () => {
		await copyStoryQueries({ id: SOURCE_ID, chatId: CHAT_ID }, COPY_ID, ['query_local']);

		expect(await listStoryQueries(COPY_ID)).toEqual({
			query_local: {
				sqlQuery: 'SELECT region FROM query_upstream',
				databaseId: LOCAL_DATABASE_ID,
				adminMode: false,
			},
			query_upstream: { sqlQuery: 'SELECT * FROM orders', databaseId: 'warehouse', adminMode: false },
		});
	});

	it('prefers the SQL edited in the chat of a story and reads the other queries from the story', async () => {
		await upsertStoryQueries(ATTACHED_ID, {
			query_upstream: { sqlQuery: 'SELECT * FROM saved_orders', databaseId: 'warehouse', adminMode: false },
			query_saved_only: { sqlQuery: 'SELECT 2', databaseId: 'warehouse', adminMode: true },
		});

		const queries = await loadStorySqlQueries({ id: ATTACHED_ID, chatId: CHAT_ID }, [
			'query_upstream',
			'query_saved_only',
		]);

		expect(queries).toEqual({
			query_upstream: { sqlQuery: 'SELECT * FROM orders', databaseId: 'warehouse', adminMode: false },
			query_saved_only: { sqlQuery: 'SELECT 2', databaseId: 'warehouse', adminMode: true },
		});
	});

	it('saves the SQL of MCP query results and the definition of MCP semantic queries', async () => {
		await copyMcpQueriesToStory(MCP_STORY_ID, ['query_mcp_sql', 'query_mcp_semantic', 'query_mcp_unknown'], {
			projectId: PROJECT_ID,
			userId: USER_ID,
		});

		expect(await listStoryQueries(MCP_STORY_ID)).toEqual({
			query_mcp_sql: { sqlQuery: 'SELECT * FROM orders', databaseId: 'warehouse', adminMode: false },
			query_mcp_semantic: {
				sqlQuery: '',
				adminMode: false,
				semanticQuery: { metrics: ['revenue'], group_by: ['metric_time__month'] },
			},
		});
	});

	it('reads a semantic query back from a chat seeded without its compiled SQL', async () => {
		const queries = await loadStorySqlQueries({ id: ATTACHED_ID, chatId: CHAT_ID }, ['query_semantic']);

		expect(queries.query_semantic).toMatchObject({ semanticQuery: { metrics: ['revenue'] } });
	});
});

async function seed() {
	await db.insert(s.user).values({ id: USER_ID, name: 'User', email: 'story-sql-user@example.com' });
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Project', type: 'local', path: '/tmp/story-sql' });
	await db.insert(s.chat).values({ id: CHAT_ID, userId: USER_ID, projectId: PROJECT_ID });
	await db.insert(s.chatMessage).values({ id: 'story-sql-message', chatId: CHAT_ID, role: 'assistant' });
	await db.insert(s.messagePart).values([
		executeSqlPart(0, 'query_upstream', 'SELECT * FROM orders', 'warehouse'),
		executeSqlPart(1, 'query_local', 'SELECT region FROM query_upstream', LOCAL_DATABASE_ID),
		executeSqlPart(2, 'query_other', 'SELECT 1', 'warehouse'),
		{
			messageId: 'story-sql-message',
			order: 3,
			type: 'tool-execute_semantic_query',
			toolName: 'execute_semantic_query',
			toolCallId: 'query_semantic-call',
			queryId: 'query_semantic',
			toolState: 'output-available',
			toolInput: { metrics: ['revenue'] },
			toolOutput: { id: 'query_semantic', compiled_sql: '' },
		} as typeof s.messagePart.$inferInsert,
	]);
	await seedMcpQuery('query_mcp_sql', 'execute_sql', { sql_query: 'SELECT * FROM orders', database_id: 'warehouse' });
	await seedMcpQuery('query_mcp_semantic', 'execute_semantic_query', {
		metrics: ['revenue'],
		group_by: ['metric_time__month'],
		chat_id: CHAT_ID,
	});
	for (const id of [COPY_ID, ATTACHED_ID, MCP_STORY_ID]) {
		await db.insert(s.story).values({ id, projectId: PROJECT_ID, userId: USER_ID, slug: id, title: id });
	}
}

function executeSqlPart(order: number, queryId: string, sqlQuery: string, databaseId: string) {
	return {
		messageId: 'story-sql-message',
		order,
		type: 'tool-execute_sql',
		toolName: 'execute_sql',
		toolCallId: `${queryId}-call`,
		queryId,
		toolState: 'output-available',
		toolInput: { sql_query: sqlQuery, database_id: databaseId },
		toolOutput: { id: queryId },
	} as typeof s.messagePart.$inferInsert;
}

async function seedMcpQuery(queryId: string, toolName: string, toolInput: Record<string, unknown>) {
	const callLogId = `${queryId}-call`;
	await db
		.insert(s.mcpCallLog)
		.values({ id: callLogId, projectId: PROJECT_ID, userId: USER_ID, toolName, success: true, toolInput });
	await db.insert(s.mcpQueryData).values({
		queryId,
		callLogId,
		projectId: PROJECT_ID,
		columns: ['n'],
		data: [{ n: 1 }],
		expiresAt: new Date(Date.now() + 60_000),
	});
}
