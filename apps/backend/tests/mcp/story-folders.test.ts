import '../../src/env';

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { registerContextLayerTools } from '../../src/mcp/tools/context-layer';
import { registerStoryFolderTools } from '../../src/mcp/tools/story-folders';
import { getSharedStoryAllowedGroupIds, getSharedStoryInfo } from '../../src/queries/shared-story.queries';
import * as storyFolderQueries from '../../src/queries/story-folder.queries';
import { createFolder, getStoryFolderItem, saveStoryInPrivateRoot } from '../../src/queries/story-folder.queries';
import { createMcpContext, FakeMcpServer } from '../helpers/fake-mcp-server';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});
vi.mock('../../src/services/agent', () => ({ agentService: { get: vi.fn() } }));

const PROJECT_ID = 'mcp-folders-project';
const OWNER_ID = 'mcp-folders-owner';
const OTHER_ID = 'mcp-folders-other';
const SALES_GROUP_ID = 'mcp-folders-sales';
const FINANCE_GROUP_ID = 'mcp-folders-finance';
const STORY_ID = 'mcp-folders-story';

describe('MCP story folder tools', () => {
	let salesFolderId: string;
	let financeFolderId: string;

	beforeAll(async () => {
		const users = [OWNER_ID, OTHER_ID];
		await db.insert(s.user).values(users.map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'MCP folders', type: 'local', path: '/tmp/mf' });
		await db
			.insert(s.projectMember)
			.values(users.map((userId) => ({ projectId: PROJECT_ID, userId, role: 'user' as const })));
		await db.insert(s.userGroup).values([
			{ id: SALES_GROUP_ID, projectId: PROJECT_ID, name: 'Sales' },
			{ id: FINANCE_GROUP_ID, projectId: PROJECT_ID, name: 'Finance' },
		]);
		await db.insert(s.userGroupMember).values({ groupId: SALES_GROUP_ID, userId: OWNER_ID });
		salesFolderId = (
			await createFolder({ ownerId: OWNER_ID, projectId: PROJECT_ID, name: 'Sales', groupIds: [SALES_GROUP_ID] })
		).id;
		financeFolderId = (
			await createFolder({
				ownerId: OTHER_ID,
				projectId: PROJECT_ID,
				name: 'Finance',
				groupIds: [FINANCE_GROUP_ID],
			})
		).id;
		await createFolder({ ownerId: OTHER_ID, projectId: PROJECT_ID, name: 'Open' });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, slug: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, title: 'Q3' });
		await saveStoryInPrivateRoot(OWNER_ID, PROJECT_ID, STORY_ID);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('lists only the folders the user sees, with who sees each one', async () => {
		const result = await callAs(OWNER_ID, 'list_story_folders', {});

		expect(result.structuredContent?.folders).toEqual([
			{ id: null, name: 'Home', parentId: null, access: 'project', teams: [] },
			expect.objectContaining({ name: 'My private folder', access: 'private', teams: [] }),
			expect.objectContaining({ name: 'Open', access: 'project', teams: [] }),
			expect.objectContaining({ id: salesFolderId, name: 'Sales', access: 'team', teams: ['Sales'] }),
		]);
	});

	it('shares a story with the team of the folder it is moved to', async () => {
		const result = await callAs(OWNER_ID, 'move_story', { story_id: STORY_ID, folder_id: salesFolderId });

		expect(result.isError).toBeUndefined();
		expect(await getStoryFolderItem(STORY_ID)).toEqual({ folderId: salesFolderId });
		const share = await getSharedStoryInfo(STORY_ID, PROJECT_ID);
		expect(await getSharedStoryAllowedGroupIds(share!.id)).toEqual([SALES_GROUP_ID]);
	});

	it('shares a story moved to Home with the whole project', async () => {
		await callAs(OWNER_ID, 'move_story', { story_id: STORY_ID, folder_id: salesFolderId });

		const result = await callAs(OWNER_ID, 'move_story', { story_id: STORY_ID, folder_id: null });

		expect(result.structuredContent).toEqual({ id: STORY_ID, folderId: null });
		expect(await getStoryFolderItem(STORY_ID)).toBeNull();
		const share = await getSharedStoryInfo(STORY_ID, PROJECT_ID);
		expect(share?.visibility).toBe('project');
		expect(await getSharedStoryAllowedGroupIds(share!.id)).toEqual([]);
	});

	it.each([
		{ label: 'a user who does not own the story', userId: OTHER_ID, error: 'Only the owner or an admin' },
		{ label: 'a folder the user cannot see', userId: OWNER_ID, error: 'Folder not found.' },
	])('refuses to move the story for $label', async ({ userId, error }) => {
		const before = await getStoryFolderItem(STORY_ID);

		const result = await callAs(userId, 'move_story', { story_id: STORY_ID, folder_id: financeFolderId });

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining(error) });
		expect(await getStoryFolderItem(STORY_ID)).toEqual(before);
	});

	it('creates a story in the folder the user picked and shares it with its team', async () => {
		const result = await callAs(OWNER_ID, 'create_story', { title: 'Pipeline', folder_id: salesFolderId });

		const storyId = result.structuredContent?.id as string;
		expect(await getStoryFolderItem(storyId)).toEqual({ folderId: salesFolderId });
		const share = await getSharedStoryInfo(storyId, PROJECT_ID);
		expect(await getSharedStoryAllowedGroupIds(share!.id)).toEqual([SALES_GROUP_ID]);
	});

	it('offers the other folders the user sees when a story is created without one', async () => {
		const result = await callAs(OWNER_ID, 'create_story', { title: 'Churn' });

		const offer = result.content.at(-1)?.text;
		expect(offer).toContain('- Home (shared with the whole project): folder_id null');
		expect(offer).toContain(`- Sales (shared with Sales): folder_id "${salesFolderId}"`);
		expect(offer).not.toContain('- My private folder');
		expect(offer).not.toContain('Finance');
	});

	it('creates no story when the picked folder is one the user cannot see', async () => {
		const result = await callAs(OWNER_ID, 'create_story', { title: 'Budget', folder_id: financeFolderId });

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Folder not found.') });
		expect(await db.select().from(s.story).where(eq(s.story.title, 'Budget'))).toEqual([]);
	});

	it('deletes the new story when the folder becomes unavailable before it is filed', async () => {
		vi.spyOn(storyFolderQueries, 'moveStoryToFolder').mockRejectedValueOnce(
			new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found.' }),
		);

		const result = await callAs(OWNER_ID, 'create_story', { title: 'Forecast', folder_id: salesFolderId });

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story).where(eq(s.story.title, 'Forecast'))).toEqual([]);
	});
});

function callAs(userId: string, tool: string, args: Record<string, unknown>) {
	const server = new FakeMcpServer();
	const context = createMcpContext({ userId, projectId: PROJECT_ID, storyCreationEnabled: true });
	registerStoryFolderTools(server.asMcpServer(), context);
	registerContextLayerTools(server.asMcpServer(), context, []);
	return server.call(tool, args);
}
