import '../../src/env';

import type { Tool } from 'ai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import storyTool from '../../src/agents/tools/story';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	createStoryVersion,
	getLatestVersionByStoryId,
	StoryVersionConflictError,
} from '../../src/queries/story.queries';
import {
	acquireStoryEditLock,
	releaseAgentStoryEditLocks,
	releaseStoryEditLock,
} from '../../src/services/story-edit-lock.service';
import { listStoryVersionChanges } from '../../src/services/story-version-history';
import { createToolContext, executeTool } from '../helpers/tool-context';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'history-project';
const OWNER_ID = 'history-owner';
const VIEWER_ID = 'history-viewer';
const ORIGIN_CHAT_ID = 'history-origin-chat';
const QUESTION_CHAT_ID = 'history-question-chat';
const OTHER_CHAT_ID = 'history-other-chat';
const STORY_ID = 'history-story';
const SLUG = 'revenue';
const STORY = { id: STORY_ID, chatId: ORIGIN_CHAT_ID };

describe('story version history', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('names where each version came from and who made it', async () => {
		await editWithAgent(ORIGIN_CHAT_ID, '# Revenue v2');
		await editWithAgent(QUESTION_CHAT_ID, '# Revenue v3');
		await editWithAgent(OTHER_CHAT_ID, '# Revenue v4');
		await saveByHand(OWNER_ID, '# Revenue v5');

		const changes = await listStoryVersionChanges(STORY, OWNER_ID);

		expect([...changes.values()].map((change) => change.via)).toEqual([
			'agent',
			'original_chat',
			'quick_question',
			'chat',
			'editor',
		]);
		expect(changes.get(5)?.author).toEqual({ id: OWNER_ID, name: 'Owner' });
	});

	it('links the chats a version came from to their owner only', async () => {
		const ownerChanges = await listStoryVersionChanges(STORY, OWNER_ID);
		const viewerChanges = await listStoryVersionChanges(STORY, VIEWER_ID);

		expect(ownerChanges.get(4)?.chat).toEqual({ id: OTHER_CHAT_ID, title: 'Another analysis' });
		expect(viewerChanges.get(4)).toMatchObject({ via: 'chat', chat: null, author: { name: 'Owner' } });
	});

	it('describes a version made before its origin was recorded by who wrote it', async () => {
		const changes = await listStoryVersionChanges(STORY, OWNER_ID);

		expect(changes.get(1)).toEqual({ author: null, via: 'agent', chat: null });
	});

	it('keeps the agent from editing while someone else edits the story, and names them', async () => {
		await acquireStoryEditLock(STORY_ID, { userId: VIEWER_ID, chatId: null });

		const output = await runAgentEdit(OTHER_CHAT_ID, '# Overwritten');

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('Viewer is editing this story'),
		});
		await releaseStoryEditLock(STORY_ID, { userId: VIEWER_ID, chatId: null });
	});

	it('keeps the first of two saves made on the same version and turns down the second', async () => {
		await expect(saveByHand(OWNER_ID, '# Owner edit', 5)).resolves.toMatchObject({ version: 6 });
		await expect(saveByHand(VIEWER_ID, '# Viewer edit', 5)).rejects.toBeInstanceOf(StoryVersionConflictError);

		expect(await getLatestVersionByStoryId(STORY_ID)).toMatchObject({ version: 6, code: '# Owner edit' });
		await expect(saveByHand(VIEWER_ID, '# Viewer edit', 6)).resolves.toMatchObject({ version: 7 });
	});

	it('turns down a save based on a version the story never had', async () => {
		const latest = await getLatestVersionByStoryId(STORY_ID);

		await expect(saveByHand(OWNER_ID, '# Ahead', (latest?.version ?? 0) + 30)).rejects.toBeInstanceOf(
			StoryVersionConflictError,
		);
		expect(await getLatestVersionByStoryId(STORY_ID)).toMatchObject({ version: latest?.version });
	});
});

function saveByHand(authorId: string, code: string, basedOnVersion?: number) {
	return createStoryVersion({
		chatId: ORIGIN_CHAT_ID,
		slug: SLUG,
		title: 'Revenue',
		code,
		action: 'replace',
		source: 'user',
		origin: 'editor',
		authorId,
		sourceChatId: null,
		basedOnVersion,
	});
}

async function editWithAgent(chatId: string, code: string) {
	const output = await runAgentEdit(chatId, code);
	await releaseAgentStoryEditLocks(chatId);
	expect(output).toMatchObject({ success: true });
}

function runAgentEdit(chatId: string, code: string) {
	const tool = storyTool as Tool<{ action: 'replace'; id: string; code: string }, { success: boolean }>;
	return executeTool(
		tool,
		{ action: 'replace', id: STORY_ID, code },
		createToolContext({ chatId, userId: OWNER_ID, projectId: PROJECT_ID, userGroupFeatures: ['storyCreation'] }),
	);
}

async function seed() {
	await db.insert(s.user).values([
		{ id: OWNER_ID, name: 'Owner', email: 'history-owner@example.com' },
		{ id: VIEWER_ID, name: 'Viewer', email: 'history-viewer@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'History', type: 'local', path: '/tmp/history' });
	await db.insert(s.chat).values([
		{ id: ORIGIN_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Revenue analysis' },
		{
			id: QUESTION_CHAT_ID,
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			title: 'Revenue',
			forkMetadata: { type: 'story_question', id: STORY_ID, title: 'Revenue', authorName: 'Owner' },
		},
		{ id: OTHER_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Another analysis' },
		{ id: 'history-unrelated-chat', userId: OWNER_ID, projectId: PROJECT_ID, title: 'Unrelated' },
	]);
	await db.insert(s.story).values({ id: STORY_ID, chatId: ORIGIN_CHAT_ID, slug: SLUG, title: 'Revenue' });
	await db
		.insert(s.storyVersion)
		.values({ storyId: STORY_ID, version: 1, code: '# Revenue', action: 'create', source: 'assistant' });
}
