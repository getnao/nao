import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	getChat,
	getChatMessages,
	getLatestContextEditChatId,
	getQueryResultByQueryId,
	listGroupedChats,
	upsertMessage,
} from '../../src/queries/chat.queries';
import { QUERY_RESULT_PREVIEW_ROWS } from '../../src/utils/query-result-preview';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'context-hub-project';
const OTHER_PROJECT_ID = 'context-hub-other-project';
const USER_ID = 'context-hub-user';
const CONTEXT_EDIT = { type: 'context_edit' as const, id: PROJECT_ID, title: 'Context Hub', authorName: '' };

afterAll(() => {
	db.$client.close();
});

describe('Context Hub chats', () => {
	beforeAll(seed);

	it.each([
		{ projectId: PROJECT_ID, expected: 'latest-context-chat' },
		{ projectId: 'project-without-chat', expected: null },
	])('resumes the latest Context Hub chat of the project $projectId', async ({ projectId, expected }) => {
		await expect(getLatestContextEditChatId(USER_ID, projectId)).resolves.toBe(expected);
	});

	it('keeps Context Hub chats out of the chat history', async () => {
		const history = await listGroupedChats(USER_ID, 'ownership', []);
		const historyIds = history.groups.flatMap((group) => group.chats.map((chat) => chat.id));

		expect(historyIds).toContain('regular-chat');
		expect(historyIds).not.toContain('latest-context-chat');
	});
});

describe('large query results', () => {
	const chatId = 'large-result-chat';
	const queryId = 'query_large_result';
	const rowCount = 5_000;

	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'large-result-user', name: 'User', email: 'large-result@example.com' });
		await db.insert(s.project).values({ id: 'large-result-project', name: 'Orders', type: 'local', path: '/tmp' });
		await db
			.insert(s.chat)
			.values({ id: chatId, userId: 'large-result-user', projectId: 'large-result-project', title: 'Orders' });
		await upsertMessage({
			chatId,
			role: 'assistant',
			parts: [
				{
					type: 'tool-execute_sql',
					toolCallId: 'large-result-call',
					state: 'output-available',
					input: { sql_query: 'select * from orders' },
					output: {
						_version: '1',
						id: queryId,
						columns: ['id'],
						data: Array.from({ length: rowCount }, (_, index) => ({ id: index })),
						row_count: rowCount,
					},
				},
			],
		});
	});

	it('loads only the first rows of a large result with the chat', async () => {
		const [chat] = await getChat(chatId, { includeFeedback: true, queryResultPreviews: true });
		const messages = await getChatMessages(chatId, { queryResultPreviews: true });

		for (const part of [chat?.messages[0].parts[0], messages[0].parts[0]]) {
			expect(part).toMatchObject({ output: { id: queryId, row_count: rowCount, is_preview: true } });
			expect(queryRows(part)).toHaveLength(QUERY_RESULT_PREVIEW_ROWS);
		}
	});

	it('keeps every row for the callers that need them', async () => {
		const [chat] = await getChat(chatId);
		const result = await getQueryResultByQueryId(chatId, queryId);

		expect(queryRows(chat?.messages[0].parts[0])).toHaveLength(rowCount);
		expect(result?.data).toHaveLength(rowCount);
	});
});

function queryRows(part: unknown): unknown[] | undefined {
	return (part as { output?: { data?: unknown[] } } | undefined)?.output?.data;
}

async function seed() {
	await db.insert(s.user).values({ id: USER_ID, name: 'User', email: 'context-hub-user@example.com' });
	await db.insert(s.project).values([
		{ id: PROJECT_ID, name: 'Context Hub', type: 'local', path: '/tmp/context-hub' },
		{ id: OTHER_PROJECT_ID, name: 'Other', type: 'local', path: '/tmp/context-hub-other' },
	]);
	await db.insert(s.projectMember).values([
		{ projectId: PROJECT_ID, userId: USER_ID, role: 'context_admin' },
		{ projectId: OTHER_PROJECT_ID, userId: USER_ID, role: 'context_admin' },
	]);
	await db.insert(s.chat).values([
		{ id: 'regular-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'Revenue' },
		{
			id: 'older-context-chat',
			userId: USER_ID,
			projectId: PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: CONTEXT_EDIT,
			updatedAt: new Date('2026-01-01'),
		},
		{
			id: 'latest-context-chat',
			userId: USER_ID,
			projectId: PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: CONTEXT_EDIT,
			updatedAt: new Date('2026-02-01'),
		},
		{
			id: 'other-project-context-chat',
			userId: USER_ID,
			projectId: OTHER_PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: { ...CONTEXT_EDIT, id: OTHER_PROJECT_ID },
			updatedAt: new Date('2026-03-01'),
		},
	]);
	await db.insert(s.chatMessage).values([
		{ id: 'regular-chat-message', chatId: 'regular-chat', role: 'user', source: 'web' },
		{ id: 'latest-context-chat-message', chatId: 'latest-context-chat', role: 'user', source: 'web' },
	]);
}
