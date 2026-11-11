import '../../src/env';

import type { Tool } from 'ai';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import storyTool from '../../src/agents/tools/story';
import { ChatForkContextPrompt } from '../../src/components/ai/chat-fork-context-prompt';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { renderToMarkdown } from '../../src/lib/markdown';
import { listGroupedChats, listQuickQuestionChats, searchUserChats } from '../../src/queries/chat.queries';
import { getLatestSqlQueriesByIds } from '../../src/queries/execute-sql.queries';
import { getLatestVersionByChatAndSlug } from '../../src/queries/story.queries';
import { resolveStoryOriginConversation } from '../../src/services/story-origin';
import { addStoryQuestionReference, resolveLinkedStory } from '../../src/services/story-question';
import type { ForkMetadata, UIMessage } from '../../src/types/chat';
import type { LinkedStory, ToolContext } from '../../src/types/tools';
import { buildQueryDataMessages } from '../../src/utils/chat-message-story';
import { createToolContext, executeTool } from '../helpers/tool-context';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'question-project';
const OWNER_ID = 'question-owner';
const VIEWER_ID = 'question-viewer';
const ORIGIN_CHAT_ID = 'question-origin-chat';
const QUESTION_CHAT_ID = 'question-chat';
const VIEWER_QUESTION_CHAT_ID = 'question-chat-of-viewer';
const STORY_ID = 'question-story';
const COPY_CHAT_ID = 'question-copy-chat';
const COPY_STORY_ID = 'question-copy-story';
const COPY_QUESTION = 'Now split it by region';
const SHARED_CHAT_QUESTION_ID = 'question-about-shared-chat';
const SHARE_ID = 'question-share';
const SLUG = 'revenue';
const ORIGINAL_CODE = '# Revenue\n\n<chart query_id="query_origin" chart_type="bar" x_axis_key="month" />\n';
const ORIGIN_QUESTION = 'Revenue by month, excluding refunded orders';
const ORIGIN_ANSWER = 'Revenue here is net of refunds, from paid orders only.';

describe('quick questions on a story', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('keeps quick questions out of the chat history and search, and lists them under their story or shared chat', async () => {
		const history = await listGroupedChats(OWNER_ID, 'none', []);
		const historyIds = history.groups.flatMap((group) => group.chats.map((chat) => chat.id));

		expect(historyIds).toContain(ORIGIN_CHAT_ID);
		expect(historyIds).not.toContain(QUESTION_CHAT_ID);
		expect(historyIds).not.toContain(SHARED_CHAT_QUESTION_ID);
		expect((await searchUserChats(OWNER_ID, 'Ask about')).map((chat) => chat.id)).toEqual([]);
		expect((await listQuickQuestionChats(OWNER_ID, STORY_ID)).map((chat) => chat.chatId)).toEqual([
			QUESTION_CHAT_ID,
		]);
		expect((await listQuickQuestionChats(OWNER_ID, SHARE_ID)).map((chat) => chat.chatId)).toEqual([
			SHARED_CHAT_QUESTION_ID,
		]);
	});

	it('links a quick question to its story, editable by its owner only', async () => {
		const forkMetadata = questionMetadata();

		expect(await resolveLinkedStory({ userId: OWNER_ID, projectId: PROJECT_ID, forkMetadata })).toMatchObject({
			storyId: STORY_ID,
			chatId: ORIGIN_CHAT_ID,
			canEdit: true,
		});
		expect(await resolveLinkedStory({ userId: VIEWER_ID, projectId: PROJECT_ID, forkMetadata })).toMatchObject({
			canEdit: false,
		});
		expect(
			await resolveLinkedStory({ userId: OWNER_ID, projectId: PROJECT_ID, forkMetadata: null }),
		).toBeUndefined();
	});

	it('references the story from the first message so its content reaches the agent', () => {
		const messages: Omit<UIMessage, 'id'>[] = [{ role: 'user', parts: [{ type: 'text', text: 'Why a dip?' }] }];

		const [first] = addStoryQuestionReference(messages, questionMetadata());

		expect(first.parts.map((part) => (part.type === 'text' ? part.text : ''))).toEqual([
			`This question is about the story @[story:${STORY_ID}].`,
			'Why a dip?',
		]);
		expect(addStoryQuestionReference(messages, null)).toBe(messages);
	});

	it('gives a chat started from the story the conversation that built it', async () => {
		const forkedStoryMetadata: ForkMetadata = { ...questionMetadata(), type: 'story' };

		for (const forkMetadata of [questionMetadata(), forkedStoryMetadata]) {
			expect(
				await resolveStoryOriginConversation({ userId: OWNER_ID, projectId: PROJECT_ID, forkMetadata }),
			).toEqual([
				{ role: 'user', text: ORIGIN_QUESTION },
				{ role: 'assistant', text: ORIGIN_ANSWER },
			]);
		}
		expect(
			await resolveStoryOriginConversation({
				userId: OWNER_ID,
				projectId: PROJECT_ID,
				forkMetadata: { type: 'chat', id: ORIGIN_CHAT_ID, title: 'Revenue analysis', authorName: 'Owner' },
			}),
		).toEqual([]);
	});

	it('keeps the conversation of a shared story private unless its chat is shared too', async () => {
		const viewerChat = { userId: VIEWER_ID, projectId: PROJECT_ID, forkMetadata: questionMetadata() };
		expect(await resolveStoryOriginConversation(viewerChat)).toEqual([]);

		const [share] = await db
			.insert(s.sharedChat)
			.values({ chatId: ORIGIN_CHAT_ID, visibility: 'specific' })
			.returning();
		await db.insert(s.sharedChatAccess).values({ sharedChatId: share.id, userId: VIEWER_ID });
		try {
			expect(await resolveStoryOriginConversation(viewerChat)).toEqual([
				{ role: 'user', text: ORIGIN_QUESTION },
				{ role: 'assistant', text: ORIGIN_ANSWER },
			]);
		} finally {
			await db.delete(s.sharedChat).where(eq(s.sharedChat.id, share.id));
		}
	});

	it('follows a copied story back to the conversation of the story it was copied from', async () => {
		expect(
			await resolveStoryOriginConversation({
				userId: OWNER_ID,
				projectId: PROJECT_ID,
				forkMetadata: { type: 'story', id: COPY_STORY_ID, title: 'Revenue', authorName: 'Owner' },
			}),
		).toEqual([
			{ role: 'user', text: ORIGIN_QUESTION },
			{ role: 'assistant', text: ORIGIN_ANSWER },
			{ role: 'user', text: COPY_QUESTION },
		]);
	});

	it('crosses a copied story whose chat the viewer cannot read to reach the shared original', async () => {
		await db.insert(s.sharedStory).values({ storyId: COPY_STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID });
		const [share] = await db
			.insert(s.sharedChat)
			.values({ chatId: ORIGIN_CHAT_ID, visibility: 'specific' })
			.returning();
		await db.insert(s.sharedChatAccess).values({ sharedChatId: share.id, userId: VIEWER_ID });
		try {
			expect(
				await resolveStoryOriginConversation({
					userId: VIEWER_ID,
					projectId: PROJECT_ID,
					forkMetadata: { type: 'story', id: COPY_STORY_ID, title: 'Revenue', authorName: 'Owner' },
				}),
			).toEqual([
				{ role: 'user', text: ORIGIN_QUESTION },
				{ role: 'assistant', text: ORIGIN_ANSWER },
			]);
		} finally {
			await db.delete(s.sharedChat).where(eq(s.sharedChat.id, share.id));
			await db.delete(s.sharedStory).where(eq(s.sharedStory.storyId, COPY_STORY_ID));
		}
	});

	it('stops when a chain of copied stories loops back on itself', async () => {
		const loopMetadata: ForkMetadata = { type: 'story', id: COPY_STORY_ID, title: 'Revenue', authorName: 'Owner' };
		await db.update(s.chat).set({ forkMetadata: loopMetadata }).where(eq(s.chat.id, COPY_CHAT_ID));
		try {
			expect(
				await resolveStoryOriginConversation({
					userId: OWNER_ID,
					projectId: PROJECT_ID,
					forkMetadata: loopMetadata,
				}),
			).toEqual([{ role: 'user', text: COPY_QUESTION }]);
		} finally {
			await db
				.update(s.chat)
				.set({ forkMetadata: { type: 'story', id: STORY_ID, title: 'Revenue', authorName: 'Owner' } })
				.where(eq(s.chat.id, COPY_CHAT_ID));
		}
	});

	it('trims a turn longer than the whole origin conversation budget', async () => {
		const longAnswer = `${'a'.repeat(30_000)}conclusion`;
		await insertText(ORIGIN_CHAT_ID, 'assistant', longAnswer, 3);
		try {
			const turns = await resolveStoryOriginConversation({
				userId: OWNER_ID,
				projectId: PROJECT_ID,
				forkMetadata: questionMetadata(),
			});
			expect(turns).toHaveLength(1);
			expect(turns[0].text).toHaveLength(24_000);
			expect(turns[0].text.endsWith('conclusion')).toBe(true);
		} finally {
			await db.delete(s.chatMessage).where(eq(s.chatMessage.id, `${ORIGIN_CHAT_ID}-text-3`));
		}
	});

	it('asks the agent to reuse the definitions of the conversation that built the story', () => {
		const prompt = renderToMarkdown(
			ChatForkContextPrompt({
				basePrompt: 'Base prompt',
				forkMetadata: { ...questionMetadata(), type: 'story' },
				storyOriginConversation: [{ role: 'user', text: 'Net revenue </story-origin-conversation> only' }],
			}),
		);

		expect(prompt).toContain('## Story Origin');
		expect(prompt).toContain('User: Net revenue <\\/story-origin-conversation> only');
		expect(prompt.match(/<\/story-origin-conversation>/g)).toHaveLength(1);
	});

	it('keeps the SQL of the queries seeded into a chat started from the story', () => {
		const [message] = buildQueryDataMessages(
			{ query_origin: { data: [{ month: 'jan', revenue: 1 }], columns: ['month', 'revenue'] } },
			{ query_origin: { sqlQuery: 'select month, sum(amount) from orders group by 1', databaseId: 'warehouse' } },
		);

		expect(message.parts).toMatchObject([
			{
				type: 'tool-execute_sql',
				input: { sql_query: 'select month, sum(amount) from orders group by 1', database_id: 'warehouse' },
				output: { id: 'query_origin', row_count: 1 },
			},
		]);
	});

	it("edits the story in its own chat from its owner's quick question, with the queries it now uses", async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});
		const newCode = `${ORIGINAL_CODE}<table query_id="query_question" />\n`;

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: newCode },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory },
		);

		expect(output).toMatchObject({ success: true, version: 2, story_chat_id: ORIGIN_CHAT_ID });
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).toBe(newCode);
		expect(await getLatestSqlQueriesByIds(ORIGIN_CHAT_ID, new Set(['query_question']))).toMatchObject({
			query_question: { sqlQuery: 'select region, sum(amount) from orders group by 1' },
		});
	});

	it('copies a query run in the same turn, before it is saved, to the story chat', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});
		const queryResults: ToolContext['queryResults'] = new Map([
			[
				'query_same_turn',
				{ columns: ['city'], data: [{ city: 'Paris' }], sqlQuery: 'select city from customers' },
			],
		]);

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: `${ORIGINAL_CODE}<table query_id="query_same_turn" />\n` },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory, queryResults },
		);

		expect(output).toMatchObject({ success: true });
		expect(await getLatestSqlQueriesByIds(ORIGIN_CHAT_ID, new Set(['query_same_turn']))).toMatchObject({
			query_same_turn: { sqlQuery: 'select city from customers' },
		});
	});

	it('copies a semantic query to the story chat as a semantic query, so the story keeps compiling it', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});
		const queryResults: ToolContext['queryResults'] = new Map([
			[
				'query_semantic_same_turn',
				{
					columns: ['orders'],
					data: [{ orders: 3 }],
					sqlQuery: 'SELECT count(*) AS orders FROM orders',
					databaseId: 'warehouse',
					semanticQuery: { metrics: ['orders'] },
				},
			],
		]);
		const code = `${ORIGINAL_CODE}<table query_id="query_semantic" />\n<table query_id="query_semantic_same_turn" />\n`;

		await runStoryTool(
			{ action: 'replace', id: STORY_ID, code },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory, queryResults },
		);

		expect(
			await getLatestSqlQueriesByIds(ORIGIN_CHAT_ID, new Set(['query_semantic', 'query_semantic_same_turn'])),
		).toMatchObject({
			query_semantic: {
				sqlQuery: 'SELECT sum(amount) AS revenue FROM orders',
				databaseId: 'warehouse',
				semanticQuery: { metrics: ['revenue'], group_by: ['metric_time__month'] },
			},
			query_semantic_same_turn: {
				sqlQuery: 'SELECT count(*) AS orders FROM orders',
				databaseId: 'warehouse',
				semanticQuery: { metrics: ['orders'] },
			},
		});
	});

	it('keeps the story read-only for anyone else', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: VIEWER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: '# Hacked' },
			{ chatId: VIEWER_QUESTION_CHAT_ID, userId: VIEWER_ID, linkedStory },
		);

		expect(output).toMatchObject({
			success: false,
			error: `Story "${STORY_ID}" is read-only here: only its owner and its editors can change it.`,
		});
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).not.toBe('# Hacked');
	});

	it('keeps editing the linked story when the question chat has a story under the same slug', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});
		await db.insert(s.story).values({ id: 'shadow-story', chatId: QUESTION_CHAT_ID, slug: SLUG, title: 'Shadow' });
		await db
			.insert(s.storyVersion)
			.values({ storyId: 'shadow-story', version: 1, code: '# Shadow', action: 'create', source: 'assistant' });
		const newCode = `${ORIGINAL_CODE}<!-- linked -->\n`;

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: newCode },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory },
		);

		expect(output).toMatchObject({ success: true });
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).toBe(newCode);
		expect((await getLatestVersionByChatAndSlug(QUESTION_CHAT_ID, SLUG))?.code).toBe('# Shadow');
	});

	it('refuses to create a story under the id of the story the question is about', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});

		const output = await runStoryTool(
			{ action: 'create', id: STORY_ID, code: '# Copy' },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory },
		);

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('it is the story this question is about'),
		});
	});

	it('refuses to create a story under the slug of the story the question is about', async () => {
		const linkedStory = await resolveLinkedStory({
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			forkMetadata: questionMetadata(),
		});

		const output = await runStoryTool(
			{ action: 'create', id: SLUG, code: '# Copy' },
			{ chatId: QUESTION_CHAT_ID, userId: OWNER_ID, linkedStory },
		);

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('it is the story this question is about'),
		});
	});

	it('stops linking the story once it is no longer shared with the user', async () => {
		await db.delete(s.sharedStory).where(eq(s.sharedStory.storyId, STORY_ID));

		expect(
			await resolveLinkedStory({ userId: VIEWER_ID, projectId: PROJECT_ID, forkMetadata: questionMetadata() }),
		).toBeUndefined();
		expect(
			await resolveLinkedStory({ userId: OWNER_ID, projectId: PROJECT_ID, forkMetadata: questionMetadata() }),
		).toMatchObject({
			canEdit: true,
		});
	});
});

function questionMetadata(): ForkMetadata {
	return { type: 'story_question', id: STORY_ID, title: 'Revenue', authorName: 'Owner' };
}

async function runStoryTool(
	input: { action: 'replace' | 'create'; id: string; code: string },
	context: {
		chatId: string;
		userId: string;
		linkedStory: LinkedStory | undefined;
		queryResults?: ToolContext['queryResults'];
	},
) {
	const tool = storyTool as Tool<typeof input, { success: boolean }>;
	return executeTool(
		tool,
		input,
		createToolContext({
			...context,
			projectId: PROJECT_ID,
			userGroupFeatures: ['storyCreation'],
			queryResults: context.queryResults ?? new Map(),
		}),
	);
}

async function seed() {
	await db.insert(s.user).values([
		{ id: OWNER_ID, name: 'Owner', email: 'question-owner@example.com' },
		{ id: VIEWER_ID, name: 'Viewer', email: 'question-viewer@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Questions', type: 'local', path: '/tmp/questions' });
	await db.insert(s.chat).values([
		{ id: ORIGIN_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Revenue analysis' },
		{
			id: QUESTION_CHAT_ID,
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			title: 'Ask about revenue',
			forkMetadata: questionMetadata(),
		},
		{
			id: VIEWER_QUESTION_CHAT_ID,
			userId: VIEWER_ID,
			projectId: PROJECT_ID,
			title: 'Viewer question',
			forkMetadata: questionMetadata(),
		},
		{
			id: COPY_CHAT_ID,
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			title: 'Revenue',
			forkMetadata: { type: 'story', id: STORY_ID, title: 'Revenue', authorName: 'Owner' },
		},
		{
			id: SHARED_CHAT_QUESTION_ID,
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			title: 'Ask about a shared chat',
			forkMetadata: { type: 'chat_question', id: SHARE_ID, title: 'Shared analysis', authorName: 'Owner' },
		},
	]);
	await db.insert(s.story).values([
		{ id: STORY_ID, chatId: ORIGIN_CHAT_ID, slug: SLUG, title: 'Revenue' },
		{ id: COPY_STORY_ID, chatId: COPY_CHAT_ID, slug: SLUG, title: 'Revenue' },
	]);
	await db.insert(s.sharedStory).values({ storyId: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID });
	await db.insert(s.storyVersion).values([
		{ storyId: STORY_ID, version: 1, code: ORIGINAL_CODE, action: 'create', source: 'assistant' },
		{ storyId: COPY_STORY_ID, version: 1, code: ORIGINAL_CODE, action: 'create', source: 'assistant' },
	]);
	await insertText(COPY_CHAT_ID, 'user', COPY_QUESTION, 1);
	await insertQuery(ORIGIN_CHAT_ID, 'query_origin', 'select month, sum(amount) from orders group by 1');
	await insertText(ORIGIN_CHAT_ID, 'user', ORIGIN_QUESTION, 1);
	await insertText(ORIGIN_CHAT_ID, 'assistant', ORIGIN_ANSWER, 2);
	await insertQuery(QUESTION_CHAT_ID, 'query_question', 'select region, sum(amount) from orders group by 1');
	await insertSemanticQuery(QUESTION_CHAT_ID, 'query_semantic');
}

async function insertText(chatId: string, role: 'user' | 'assistant', text: string, order: number) {
	const messageId = `${chatId}-text-${order}`;
	await db.insert(s.chatMessage).values({ id: messageId, chatId, role, createdAt: new Date(order) });
	await db.insert(s.messagePart).values({ messageId, order: 0, type: 'text', text });
}

async function insertSemanticQuery(chatId: string, queryId: string) {
	const messageId = `${chatId}-${queryId}`;
	await db.insert(s.chatMessage).values({ id: messageId, chatId, role: 'assistant' });
	await db.insert(s.messagePart).values({
		messageId,
		order: 0,
		type: 'tool-execute_semantic_query',
		toolName: 'execute_semantic_query',
		toolCallId: `${messageId}-call`,
		toolState: 'output-available',
		toolInput: { metrics: ['revenue'], group_by: ['metric_time__month'], name: 'Revenue by month' },
		toolOutput: {
			id: queryId,
			columns: ['metric_time__month', 'revenue'],
			data: [{ metric_time__month: '2026-01-01', revenue: 100 }],
			row_count: 1,
			compiled_sql: 'SELECT sum(amount) AS revenue FROM orders',
			database_id: 'warehouse',
		},
	} as typeof s.messagePart.$inferInsert);
}

async function insertQuery(chatId: string, queryId: string, sqlQuery: string) {
	const messageId = `${chatId}-${queryId}`;
	await db.insert(s.chatMessage).values({ id: messageId, chatId, role: 'assistant' });
	await db.insert(s.messagePart).values({
		messageId,
		order: 0,
		type: 'tool-execute_sql',
		toolName: 'execute_sql',
		toolCallId: `${messageId}-call`,
		toolState: 'output-available',
		toolInput: { sql_query: sqlQuery },
		toolOutput: { id: queryId, columns: ['label', 'value'], data: [{ label: 'a', value: 1 }], row_count: 1 },
	} as typeof s.messagePart.$inferInsert);
}
