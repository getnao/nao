import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { registerAssetTools } from '../../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../../src/mcp/tools/context-layer';
import { callNaoInternalMcpTool, listNaoInternalMcpTools } from '../../src/services/nao-internal-mcp';
import { createMcpContext, FakeMcpServer } from '../helpers/fake-mcp-server';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const server = new FakeMcpServer();
const context = createMcpContext({ storyCreationEnabled: true });
registerContextLayerTools(server.asMcpServer(), context, []);
registerAssetTools(server.asMcpServer(), context);

const WEEKLY_LIVE = {
	enabled: true,
	refresh_schedule: '0 9 * * 1',
	refresh_schedule_description: 'every Monday at 9am',
	regenerate_text: true,
};

describe('MCP live story settings', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
	});

	beforeEach(async () => {
		await db.delete(s.story);
		await db.delete(s.scheduledJob);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('creates a live story on its refresh schedule and shows its settings in get_story', async () => {
		const created = await server.call('create_story', {
			chat_id: 'chat-1',
			title: 'Weekly revenue',
			content: '# Weekly revenue',
			live: WEEKLY_LIVE,
		});
		const storyId = created.structuredContent?.id as string;

		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({
			isLive: true,
			isLiveTextDynamic: true,
			cacheSchedule: '0 9 * * 1',
			cacheScheduleDescription: 'every Monday at 9am',
		});
		expect(await db.select().from(s.scheduledJob)).toHaveLength(1);
		const read = await server.call('get_story', { story_id: storyId });
		expect(JSON.parse(read.content[0].text as string).live).toEqual({
			enabled: true,
			refreshSchedule: '0 9 * * 1',
			refreshScheduleDescription: 'every Monday at 9am',
			regenerateText: true,
		});
	});

	it('changes only the live settings without a new version, and clears them all when turned off', async () => {
		const created = await server.call('create_story', { chat_id: 'chat-1', title: 'Sales', content: '# Sales' });
		const storyId = created.structuredContent?.id as string;

		await server.call('update_story', { story_id: storyId, live: WEEKLY_LIVE });
		expect(await db.select().from(s.storyVersion)).toHaveLength(1);
		expect(await db.select().from(s.scheduledJob)).toHaveLength(1);

		await server.call('update_story', { story_id: storyId, live: { enabled: false } });
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({
			isLive: false,
			isLiveTextDynamic: false,
			cacheSchedule: null,
			cacheScheduleDescription: null,
		});
		expect(await db.select().from(s.scheduledJob)).toHaveLength(0);
	});

	it('saves the story but refuses to make it live when it has no queries to rerun', async () => {
		const result = await server.call('create_story', {
			title: 'Frozen',
			content: '<table query_id="query_frozen" />',
			query_data: { query_frozen: { columns: ['value'], data: [{ value: 1 }] } },
			live: WEEKLY_LIVE,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('is saved, but its live settings were not changed');
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({ title: 'Frozen', isLive: false });
	});

	it('keeps the SQL of MCP queries when a chat story goes live, so its refresh can rerun them', async () => {
		await db.insert(s.mcpCallLog).values({
			id: 'call-mcp',
			projectId: 'project-1',
			userId: 'user-1',
			toolName: 'execute_sql',
			success: true,
			toolInput: { sql_query: 'SELECT 1 AS value' },
		});
		await db.insert(s.mcpQueryData).values({
			queryId: 'query_mcp',
			callLogId: 'call-mcp',
			projectId: 'project-1',
			columns: ['value'],
			data: [{ value: 1 }],
			expiresAt: new Date(Date.now() + 60_000),
		});

		await server.call('create_story', {
			chat_id: 'chat-1',
			title: 'MCP revenue',
			content: '<table query_id="query_mcp" />',
			live: WEEKLY_LIVE,
		});

		const savedQueries = await db.select().from(s.storyQuery);
		expect(savedQueries).toMatchObject([{ queryId: 'query_mcp', sqlQuery: 'SELECT 1 AS value' }]);
	});

	it("lets nao's own agent make a story live through its internal server, for story creators only", async () => {
		const created = await server.call('create_story', { chat_id: 'chat-1', title: 'Sales', content: '# Sales' });
		const storyCreator = {
			projectId: 'project-1',
			userId: 'user-1',
			userGroupFeatures: ['storyCreation' as const],
		};

		const result = await callNaoInternalMcpTool(storyCreator, 'set_story_live', {
			story_id: created.structuredContent?.id,
			live: WEEKLY_LIVE,
		});

		expect(result).toMatchObject({ structuredContent: { title: 'Sales', live: { enabled: true } } });
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({ isLive: true, cacheSchedule: '0 9 * * 1' });
		expect(await listNaoInternalMcpTools({ ...storyCreator, userGroupFeatures: [] })).toEqual([]);
	});
});
