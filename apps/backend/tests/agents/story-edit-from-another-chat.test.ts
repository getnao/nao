import '../../src/env';

import type { Tool } from 'ai';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import storyTool from '../../src/agents/tools/story';
import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { __reloadEnvForTesting } from '../../src/env';
import { getLatestSqlQueriesByIds } from '../../src/queries/execute-sql.queries';
import { getLatestVersionByChatAndSlug, getStoryById } from '../../src/queries/story.queries';
import { getDraftFile } from '../../src/queries/story-file.queries';
import { findEditableStory } from '../../src/services/editable-story';
import { attachChatToStandaloneStory } from '../../src/services/standalone-story';
import {
	findStoryMountFiles,
	listStoryMount,
	listStoryMountFilesToGrep,
	readStoryMountFile,
	writeStoryMountFile,
} from '../../src/services/story-mount';
import { expandStoryReferences } from '../../src/services/story-reference';
import type { UIMessage } from '../../src/types/chat';
import type { ToolContext } from '../../src/types/tools';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'edit-project';
const OWNER_ID = 'edit-owner';
const VIEWER_ID = 'edit-viewer';
const ORIGIN_CHAT_ID = 'edit-origin-chat';
const EDITING_CHAT_ID = 'edit-new-chat';
const VIEWER_CHAT_ID = 'edit-viewer-chat';
const STORY_ID = 'edit-story';
const SAME_SLUG_STORY_ID = 'edit-story-same-slug';
const STANDALONE_STORY_ID = 'edit-standalone-story';
const CUSTOM_STORY_ID = 'edit-custom-story';
const STANDALONE_CUSTOM_STORY_ID = 'edit-standalone-custom-story';
const UNTOUCHED_STORY_ID = 'edit-untouched-story';
const SLUG = 'revenue';
const ORIGINAL_CODE = '# Revenue\n\n<chart query_id="query_origin" chart_type="bar" x_axis_key="month" />\n';

describe('editing a story from another chat', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('marks the stories the user can edit in their referenced story block', async () => {
		const [ownerMessage] = await expandStoryReferences([userMessage(`@[story:${STORY_ID}]`)], {
			userId: OWNER_ID,
			projectId: PROJECT_ID,
		});
		const [viewerMessage] = await expandStoryReferences([userMessage(`@[story:${STORY_ID}]`)], {
			userId: VIEWER_ID,
			projectId: PROJECT_ID,
		});

		expect(textOf(ownerMessage)).toContain(`format="classic" editable="true" version="1">`);
		expect(textOf(viewerMessage)).toContain(`format="classic" version="1">`);
	});

	it('edits the story in its own chat from its id, with the queries its new version uses', async () => {
		const newCode = `${ORIGINAL_CODE}<table query_id="query_new_chat" />\n`;

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: newCode },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		expect(output).toMatchObject({
			success: true,
			id: SLUG,
			version: 2,
			story_chat_id: ORIGIN_CHAT_ID,
			story_id: STORY_ID,
		});
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).toBe(newCode);
		expect(await getLatestSqlQueriesByIds(ORIGIN_CHAT_ID, new Set(['query_new_chat']))).toMatchObject({
			query_new_chat: { sqlQuery: 'select region, sum(amount) from orders group by 1' },
		});
	});

	it('tells apart a story of this chat and one of another chat under the same slug', async () => {
		const output = await runStoryTool(
			{ action: 'update', id: SAME_SLUG_STORY_ID, search: '# Same slug', replace: '# Same slug, edited' },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		expect(output).toMatchObject({ success: true });
		expect(output).not.toHaveProperty('story_chat_id');
		expect((await getLatestVersionByChatAndSlug(EDITING_CHAT_ID, SLUG))?.code).toBe('# Same slug, edited');
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).not.toContain('Same slug');
	});

	it('no longer finds a story by its slug', async () => {
		const output = await runStoryTool(
			{ action: 'replace', id: SLUG, code: '# Wrong id' },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		expect(output).toMatchObject({ success: false, error: expect.stringContaining('No story with the id') });
		expect((await getLatestVersionByChatAndSlug(EDITING_CHAT_ID, SLUG))?.code).not.toBe('# Wrong id');
	});

	it('keeps the story read-only for a user who can only see it', async () => {
		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: '# Hacked' },
			{ chatId: VIEWER_CHAT_ID, userId: VIEWER_ID },
		);

		expect(output).toMatchObject({
			success: false,
			error: `Story "${STORY_ID}" is read-only here: only its owner and its editors can change it.`,
		});
		expect((await getLatestVersionByChatAndSlug(ORIGIN_CHAT_ID, SLUG))?.code).not.toBe('# Hacked');
	});

	it('does not reach a story the user cannot see', async () => {
		await db.update(s.sharedStory).set({ visibility: 'specific' }).where(eq(s.sharedStory.storyId, STORY_ID));

		const output = await runStoryTool(
			{ action: 'replace', id: STORY_ID, code: '# Hacked' },
			{ chatId: VIEWER_CHAT_ID, userId: VIEWER_ID },
		);

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('No story with the id'),
		});
		await db.update(s.sharedStory).set({ visibility: 'project' }).where(eq(s.sharedStory.storyId, STORY_ID));
	});

	it('gives a standalone story a chat of its owner to hold the new version', async () => {
		const output = await runStoryTool(
			{ action: 'replace', id: STANDALONE_STORY_ID, code: '# Standalone, edited' },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		const story = await getStoryById(STANDALONE_STORY_ID);
		expect(story?.chatId).toBeTruthy();
		expect(output).toMatchObject({ success: true, story_chat_id: story?.chatId, story_id: STANDALONE_STORY_ID });
		expect((await getLatestVersionByChatAndSlug(story!.chatId!, 'standalone'))?.code).toBe('# Standalone, edited');
	});

	it('leaves a standalone story without a chat when its edit fails', async () => {
		const failures = [
			{ action: 'replace' as const, id: UNTOUCHED_STORY_ID },
			{ action: 'update' as const, id: UNTOUCHED_STORY_ID, search: 'not in the story', replace: 'x' },
			{ action: 'delete_files' as const, id: UNTOUCHED_STORY_ID, paths: ['app.jsx'] },
		];

		for (const input of failures) {
			const output = await runStoryTool(input, { chatId: EDITING_CHAT_ID, userId: OWNER_ID });

			expect(output).toMatchObject({ success: false, story_id: UNTOUCHED_STORY_ID });
			expect(output).not.toHaveProperty('story_chat_id');
		}
		expect((await getStoryById(UNTOUCHED_STORY_ID))?.chatId).toBeNull();
	});

	it('gives a standalone story a single chat when two edits attach one at once', async () => {
		const story = {
			id: 'edit-raced-story',
			slug: 'raced',
			title: 'Raced',
			code: '# Raced',
			format: 'classic' as const,
		};
		await db
			.insert(s.story)
			.values({ id: story.id, slug: story.slug, title: story.title, userId: OWNER_ID, projectId: PROJECT_ID });
		const owner = { userId: OWNER_ID, projectId: PROJECT_ID };

		const [first, second] = await Promise.all([
			attachChatToStandaloneStory(story, owner),
			attachChatToStandaloneStory(story, owner),
		]);

		expect(first.chatId).toBe(second.chatId);
		expect((await getStoryById(story.id))?.chatId).toBe(first.chatId);
		expect(await db.select().from(s.chat).where(eq(s.chat.title, 'Raced'))).toHaveLength(1);
	});

	it('keeps a standalone story of someone else out of reach of a caller without a chat', async () => {
		await db.insert(s.story).values({
			id: 'edit-private-standalone',
			slug: 'private',
			title: 'Private',
			userId: OWNER_ID,
			projectId: PROJECT_ID,
		});
		await db.insert(s.storyVersion).values({
			storyId: 'edit-private-standalone',
			version: 1,
			code: '# Private',
			action: 'create',
			source: 'user',
		});

		const found = await findEditableStory(
			{ chatId: null as unknown as string, userId: VIEWER_ID, projectId: PROJECT_ID },
			'edit-private-standalone',
		);

		expect(found).toHaveProperty('error');
	});

	it('mounts the draft of a custom story of another chat under its id', async () => {
		process.env.BETA_CUSTOM_STORIES_ENABLED = 'true';
		__reloadEnvForTesting();
		const scope = { chatId: EDITING_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID };

		await writeStoryMountFile(scope, `/stories/${CUSTOM_STORY_ID}/app.jsx`, 'export default function App() {}\n');

		expect((await getDraftFile(CUSTOM_STORY_ID, 'app.jsx'))?.content).toContain('export default function App()');
		await expect(
			writeStoryMountFile(
				{ chatId: VIEWER_CHAT_ID, userId: VIEWER_ID, projectId: PROJECT_ID },
				`/stories/${CUSTOM_STORY_ID}/app.jsx`,
				'// hacked\n',
			),
		).rejects.toThrow('read-only');
	});

	it('keeps addressing a custom story of another chat by its id when listing and searching it', async () => {
		const scope = { chatId: EDITING_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID };

		expect(await listStoryMount(scope, `/stories/${CUSTOM_STORY_ID}`)).toMatchObject([
			{ path: `/stories/${CUSTOM_STORY_ID}/app.jsx`, name: 'app.jsx' },
		]);
		expect(await listStoryMountFilesToGrep(scope, `/stories/${CUSTOM_STORY_ID}`, undefined)).toMatchObject([
			{ virtualPath: `/stories/${CUSTOM_STORY_ID}/app.jsx` },
		]);
	});

	it('finds the files of a custom story of another chat when a search names its id', async () => {
		process.env.BETA_CUSTOM_STORIES_ENABLED = 'true';
		__reloadEnvForTesting();
		const scope = { chatId: EDITING_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID };
		await writeStoryMountFile(scope, `/stories/${CUSTOM_STORY_ID}/app.jsx`, 'export default function App() {}\n');
		const isInStory = (mountRelativePath: string) => {
			return mountRelativePath.startsWith(`stories/${CUSTOM_STORY_ID}/`);
		};

		expect(await findStoryMountFiles(scope, isInStory, CUSTOM_STORY_ID)).toMatchObject([
			{ path: `/stories/${CUSTOM_STORY_ID}/app.jsx` },
		]);
		expect(await findStoryMountFiles(scope, isInStory)).toEqual([]);
		expect(
			await findStoryMountFiles(
				{ chatId: VIEWER_CHAT_ID, userId: 'edit-stranger', projectId: PROJECT_ID },
				isInStory,
				CUSTOM_STORY_ID,
			),
		).toEqual([]);
	});

	it('only gives a standalone custom story a chat once a new version needs one', async () => {
		const scope = { chatId: EDITING_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID };
		const path = `/stories/${STANDALONE_CUSTOM_STORY_ID}/app.jsx`;

		await writeStoryMountFile(scope, path, 'export default function App() {}\n');

		expect(await readStoryMountFile(scope, path)).toContain('export default function App()');
		expect((await getStoryById(STANDALONE_CUSTOM_STORY_ID))?.chatId).toBeNull();

		const output = await runStoryTool(
			{ action: 'delete_files', id: STANDALONE_CUSTOM_STORY_ID, paths: [path] },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		expect(output).toMatchObject({ success: true, story_id: STANDALONE_CUSTOM_STORY_ID });
		expect((await getStoryById(STANDALONE_CUSTOM_STORY_ID))?.chatId).toBeTruthy();
	});

	it('deletes a draft file of a custom story of another chat by its mounted path', async () => {
		const output = await runStoryTool(
			{ action: 'delete_files', id: CUSTOM_STORY_ID, paths: [`/stories/${CUSTOM_STORY_ID}/app.jsx`] },
			{ chatId: EDITING_CHAT_ID, userId: OWNER_ID },
		);

		expect(output).toMatchObject({ success: true, story_id: CUSTOM_STORY_ID });
		expect(await getDraftFile(CUSTOM_STORY_ID, 'app.jsx')).toBeFalsy();
	});
});

async function runStoryTool(
	input: {
		action: 'replace' | 'update' | 'delete_files';
		id: string;
		code?: string;
		search?: string;
		replace?: string;
		paths?: string[];
	},
	context: { chatId: string; userId: string },
) {
	const tool = storyTool as Tool<typeof input, Record<string, unknown>>;
	return tool.execute!(input, {
		toolCallId: 'story-call',
		messages: [],
		experimental_context: {
			...context,
			projectId: PROJECT_ID,
			userGroupFeatures: ['storyCreation', 'customStoryCreation'],
			queryResults: new Map(),
			generatedArtifacts: { charts: [], maps: [], stories: [] },
		} as unknown as ToolContext,
	});
}

function userMessage(text: string): Omit<UIMessage, 'id'> {
	return { role: 'user', parts: [{ type: 'text', text }] };
}

function textOf(message: Omit<UIMessage, 'id'>): string {
	return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
}

async function seed() {
	await db.insert(s.user).values([
		{ id: OWNER_ID, name: 'Owner', email: 'edit-owner@example.com' },
		{ id: VIEWER_ID, name: 'Viewer', email: 'edit-viewer@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Edits', type: 'local', path: '/tmp/edits' });
	await db.insert(s.chat).values([
		{ id: ORIGIN_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Revenue analysis' },
		{ id: EDITING_CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'A new chat' },
		{ id: VIEWER_CHAT_ID, userId: VIEWER_ID, projectId: PROJECT_ID, title: 'Viewer chat' },
	]);
	await db.insert(s.story).values([
		{ id: STORY_ID, chatId: ORIGIN_CHAT_ID, slug: SLUG, title: 'Revenue' },
		{ id: SAME_SLUG_STORY_ID, chatId: EDITING_CHAT_ID, slug: SLUG, title: 'Same slug' },
		{ id: STANDALONE_STORY_ID, userId: OWNER_ID, projectId: PROJECT_ID, slug: 'standalone', title: 'Standalone' },
		{ id: UNTOUCHED_STORY_ID, userId: OWNER_ID, projectId: PROJECT_ID, slug: 'untouched', title: 'Untouched' },
		{ id: CUSTOM_STORY_ID, chatId: ORIGIN_CHAT_ID, slug: 'custom', title: 'Custom', format: 'custom' },
		{
			id: STANDALONE_CUSTOM_STORY_ID,
			userId: OWNER_ID,
			projectId: PROJECT_ID,
			slug: 'standalone-custom',
			title: 'Standalone custom',
			format: 'custom',
		},
	]);
	await db.insert(s.sharedStory).values([
		{ storyId: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, visibility: 'project' },
		{ storyId: CUSTOM_STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, visibility: 'project' },
	]);
	await db.insert(s.storyVersion).values([
		{ storyId: STORY_ID, version: 1, code: ORIGINAL_CODE, action: 'create', source: 'assistant' },
		{ storyId: SAME_SLUG_STORY_ID, version: 1, code: '# Same slug', action: 'create', source: 'assistant' },
		{ storyId: STANDALONE_STORY_ID, version: 1, code: '# Standalone', action: 'create', source: 'user' },
		{ storyId: UNTOUCHED_STORY_ID, version: 1, code: '# Untouched', action: 'create', source: 'assistant' },
		{ storyId: CUSTOM_STORY_ID, version: 1, code: '', action: 'create', source: 'assistant' },
		{ storyId: STANDALONE_CUSTOM_STORY_ID, version: 1, code: '', action: 'create', source: 'assistant' },
	]);
	await insertQuery(ORIGIN_CHAT_ID, 'query_origin', 'select month, sum(amount) from orders group by 1');
	await insertQuery(EDITING_CHAT_ID, 'query_new_chat', 'select region, sum(amount) from orders group by 1');
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
