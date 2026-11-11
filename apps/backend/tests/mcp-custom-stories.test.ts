import '../src/env';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import type { ToolResult } from '../src/mcp/logging';
import { registerAssetTools } from '../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import * as chatQueries from '../src/queries/chat.queries';
import { upsertMcpQueryData } from '../src/queries/mcp-query-data.queries';
import * as storyFileQueries from '../src/queries/story-file.queries';
import { executeLiveQuery } from '../src/services/live-story';
import { buildQueryPart } from '../src/utils/chat-message-story';

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

	const database = drizzle(sqlite, { schema: sqliteSchema });
	return {
		db: Object.assign(database, {
			transaction: (run: (tx: typeof database) => Promise<unknown>) => run(database),
		}),
	};
});

const buildErrors = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../src/services/story-app-build', () => ({
	buildStoryApp: async () =>
		buildErrors.current.length > 0
			? { ok: false, errors: buildErrors.current }
			: { ok: true, app: { kind: 'react', bundle: 'bundle' }, entry: 'app.jsx' },
}));

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

class FakeMcpServer {
	readonly handlers = new Map<string, Handler>();

	registerTool(name: string, _config: unknown, handler: Handler): void {
		this.handlers.set(name, handler);
	}
}

const APP_FILES = [
	{ path: 'nao.json', content: '{ "entry": "app.jsx" }' },
	{ path: 'app.jsx', content: 'export default function App() { return null; }' },
];

const server = new FakeMcpServer();
registerContextLayerTools(
	server as never,
	{
		userId: 'user-1',
		projectId: 'project-1',
		settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
		chartDataMode: false,
		storyCreationEnabled: true,
		customStoryCreationEnabled: true,
	},
	[],
);
registerAssetTools(server as never, {
	userId: 'user-1',
	projectId: 'project-1',
	settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
	chartDataMode: false,
	storyCreationEnabled: true,
	customStoryCreationEnabled: true,
});

function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
	return server.handlers.get(name)!(args, {});
}

describe('MCP custom stories through create_story and update_story', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: 'user-1', name: 'User', email: 'user@example.com' },
			{ id: 'user-2', name: 'Other', email: 'other@example.com' },
		]);
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values([
			{ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' },
			{ id: 'chat-2', projectId: 'project-1', userId: 'user-2', title: 'Other chat' },
		]);
		await db.insert(s.mcpCallLog).values({
			id: 'mcp-query-call',
			projectId: 'project-1',
			userId: 'user-1',
			toolName: 'execute_sql',
			success: true,
		});
		await upsertMcpQueryData('query_mcp', 'mcp-query-call', 'project-1', ['value'], [{ value: 1 }], {
			sourceChatId: 'chat-1',
		});
	});

	beforeEach(async () => {
		buildErrors.current = [];
		await db.delete(s.story);
	});

	it('creates and publishes a custom story, returning only its link', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Revenue App',
			files: APP_FILES,
		});

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ title: 'Revenue App', format: 'custom', version: 1 });
		expect(result.structuredContent).not.toHaveProperty('embedUrl');
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({ chatId: 'chat-1', slug: 'revenue-app', format: 'custom' });
		expect(await db.select().from(s.storyFolderItem)).toHaveLength(1);
	});

	it('returns the starter app as an unpublished draft when no files are given', async () => {
		const result = await call('create_story', { format: 'custom', chat_id: 'chat-1', title: 'Starter' });

		expect(result.structuredContent).toMatchObject({ version: 0 });
		const sourceFiles = (result.structuredContent?.sourceFiles ?? []) as { path: string }[];
		expect(sourceFiles.map((file) => file.path)).toEqual(expect.arrayContaining(['nao.json', 'app.jsx']));
		expect(await db.select().from(s.storyVersion)).toHaveLength(0);
	});

	it('gets an unpublished custom story draft by id', async () => {
		const created = await call('create_story', { format: 'custom', chat_id: 'chat-1', title: 'Draft Lookup' });
		const storyId = created.structuredContent?.id as string;

		const result = await call('get_story', { story_id: storyId });

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({
			id: storyId,
			title: 'Draft Lookup',
			format: 'custom',
			version: 0,
		});
		const sourceFiles = (result.structuredContent?.sourceFiles ?? []) as { path: string }[];
		expect(sourceFiles.map((file) => file.path)).toEqual(expect.arrayContaining(['nao.json', 'app.jsx']));
	});

	it('keeps a draft that does not build, then publishes it once update_story fixes it', async () => {
		buildErrors.current = ['app.jsx: Unexpected token'];
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Broken',
			files: APP_FILES,
		});
		expect(created.structuredContent).toMatchObject({ version: 0, buildErrors: ['app.jsx: Unexpected token'] });

		buildErrors.current = [];
		const storyId = created.structuredContent?.id as string;
		const updated = await call('update_story', {
			story_id: storyId,
			files: [{ path: 'app.jsx', content: 'export default function App() { return 1; }' }],
		});

		expect(updated.structuredContent).toMatchObject({ id: storyId, version: 1 });
		expect(updated.structuredContent).not.toHaveProperty('buildErrors');
	});

	it('deletes files from the draft and refuses paths that are not in it', async () => {
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Cleanup',
			files: [...APP_FILES, { path: 'old.jsx', content: 'export const old = 1;' }],
		});
		const storyId = created.structuredContent?.id as string;

		const missing = await call('update_story', { story_id: storyId, delete_paths: ['nope.jsx'] });
		expect(missing.isError).toBe(true);

		await call('update_story', { story_id: storyId, delete_paths: ['old.jsx'] });
		const draft = await storyFileQueries.listDraftFiles(storyId);
		expect(draft.map((file) => file.path)).toEqual(['app.jsx', 'nao.json']);
	});

	it("refuses another user's chat and story", async () => {
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-2',
			title: 'Theirs',
			files: APP_FILES,
		});
		expect(created.isError).toBe(true);

		await db
			.insert(s.story)
			.values({ id: 'story-2', chatId: 'chat-2', slug: 'theirs', title: 'Theirs', format: 'custom' });
		const updated = await call('update_story', { story_id: 'story-2', files: APP_FILES });
		expect(updated.isError).toBe(true);
	});

	it('refuses a title already used in the chat', async () => {
		await call('create_story', { format: 'custom', chat_id: 'chat-1', title: 'Twice', files: APP_FILES });
		const second = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Twice',
			files: APP_FILES,
		});

		expect(second.isError).toBe(true);
	});

	it('keeps classic and custom inputs apart', async () => {
		const customWithContent = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Mixed',
			content: '# Mixed',
		});
		expect(customWithContent.isError).toBe(true);

		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'App',
			files: APP_FILES,
		});
		const storyId = created.structuredContent?.id as string;
		const updateWithContent = await call('update_story', { story_id: storyId, content: '# Not markdown' });
		expect(updateWithContent.isError).toBe(true);
	});

	it('creates a standalone custom story without a chat, with the rows passed in `query_data`', async () => {
		const queryRows = { columns: ['value'], data: [{ value: 1 }] };
		const result = await call('create_story', {
			format: 'custom',
			title: 'No chat',
			files: [...APP_FILES, { path: 'data.js', content: 'export const id = "query_revenue";' }],
			query_data: { query_revenue: queryRows },
		});

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ title: 'No chat', format: 'custom', version: 1 });
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({ chatId: null, projectId: 'project-1', userId: 'user-1', slug: 'no-chat' });
		const [cache] = await db.select().from(s.storyDataCache);
		expect(cache).toMatchObject({ storyId: story.id, queryData: { query_revenue: queryRows } });
		expect(await db.select().from(s.storyFolderItem)).toHaveLength(1);
	});

	it('updates a standalone custom story as a new version', async () => {
		const created = await call('create_story', { format: 'custom', title: 'No chat', files: APP_FILES });
		const storyId = (created.structuredContent as { id: string }).id;

		const result = await call('update_story', {
			story_id: storyId,
			files: [{ path: 'app.jsx', content: 'export default function App() { return "v2"; }' }],
		});

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ id: storyId, version: 2 });
	});

	it('refuses `query_data` for a custom story attached to a chat', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'In chat',
			files: APP_FILES,
			query_data: { query_revenue: { columns: ['value'], data: [] } },
		});

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story)).toHaveLength(0);
	});

	it('rejects an MCP query in a chat-linked app before creating a story', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'MCP query in chat',
			files: [...APP_FILES, { path: 'data.js', content: 'useQueryData("query_mcp")' }],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining('cannot refresh') });
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining('omit `chat_id`') });
		expect(await db.select().from(s.story)).toHaveLength(0);
	});

	it('allows unrelated query-like identifiers and comments on create and update', async () => {
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Unrelated query text',
			files: [
				APP_FILES[0],
				{
					path: 'app.jsx',
					content:
						'export default function App() { const query_status = "ready"; /* query_old */ return query_status; }',
				},
			],
		});
		const storyId = created.structuredContent?.id as string;

		expect(created.isError).toBeUndefined();
		const updated = await call('update_story', {
			story_id: storyId,
			files: [
				{
					path: 'app.jsx',
					content: 'export default function App() { // query_mcp is not used\n return null; }',
				},
			],
		});
		expect(updated.isError).toBeUndefined();
		expect(updated.structuredContent).toMatchObject({ id: storyId, version: 2 });
	});

	it('rejects an MCP query used as a JSX block prop', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'MCP block query',
			files: [
				APP_FILES[0],
				{
					path: 'app.jsx',
					content:
						'import { KpiCard } from "@nao/story-kit"; export default function App() { return <KpiCard queryId="query_mcp" />; }',
				},
			],
		});

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story)).toHaveLength(0);
	});

	it('allows an unrelated component with a queryId prop', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Unrelated query prop',
			files: [
				APP_FILES[0],
				{
					path: 'app.jsx',
					content:
						'function Widget({ queryId }) { return <span>{queryId}</span>; } export default function App() { return <Widget queryId="query_mcp" />; }',
				},
			],
		});

		expect(result.isError).toBeUndefined();
	});

	it('explains an MCP query passed to useQueryData through a constant at runtime', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'MCP constant query',
			files: [
				APP_FILES[0],
				{
					path: 'app.jsx',
					content:
						'const dataId = "query_mcp"; export default function App() { return useQueryData(dataId); }',
				},
			],
		});

		expect(result.isError).toBeUndefined();
		await expect(executeLiveQuery('chat-1', 'query_mcp')).rejects.toThrow(
			'MCP execute_sql results are snapshots, even when chat_id is set',
		);
	});

	it('allows a valid query constant shadowed by a helper local on create and update', async () => {
		await chatQueries.upsertMessage({
			chatId: 'chat-1',
			role: 'assistant',
			parts: [
				buildQueryPart(
					'query_chat_scoped',
					{ sqlQuery: 'SELECT 4 AS value' },
					{ columns: ['value'], data: [{ value: 4 }] },
				),
			],
		});
		const app =
			'import { KpiCard } from "@nao/story-kit"; const id = "query_chat_scoped"; export default function App() { return <KpiCard queryId={id} />; } function helper() { const id = "query_old"; return id; }';
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Scoped query ID',
			files: [APP_FILES[0], { path: 'app.jsx', content: app }],
		});

		expect(created.isError).toBeUndefined();
		const storyId = created.structuredContent?.id as string;
		const updated = await call('update_story', {
			story_id: storyId,
			files: [{ path: 'app.jsx', content: app }],
		});
		expect(updated.isError).toBeUndefined();
		expect(updated.structuredContent).toMatchObject({ id: storyId, version: 2 });
	});

	it('ignores a query call inside an HTML comment', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'HTML comment',
			files: [
				{ path: 'nao.json', content: '{ "entry": "index.html" }' },
				{ path: 'index.html', content: '<!-- <script>nao.query("query_mcp")</script> --><main>Ready</main>' },
			],
		});

		expect(result.isError).toBeUndefined();
	});

	it('rejects an MCP query used by an HTML story script', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'HTML query',
			files: [
				{ path: 'nao.json', content: '{ "entry": "index.html" }' },
				{ path: 'index.html', content: '<script>nao.query("query_mcp")</script>' },
			],
		});

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story)).toHaveLength(0);
	});

	it('rejects an MCP query used by the HTML querySql API', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'HTML SQL query',
			files: [
				{ path: 'nao.json', content: '{ "entry": "index.html" }' },
				{ path: 'index.html', content: '<script>nao.querySql("query_mcp")</script>' },
			],
		});

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story)).toHaveLength(0);
	});

	it('keeps an invalid MCP query out of an existing chat-linked draft', async () => {
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Valid before edit',
			files: APP_FILES,
		});
		const storyId = created.structuredContent?.id as string;

		const result = await call('update_story', {
			story_id: storyId,
			files: [{ path: 'data.js', content: 'useQueryData("query_mcp")' }],
		});

		expect(result.isError).toBe(true);
		expect((await storyFileQueries.listDraftFiles(storyId)).map((file) => file.path)).toEqual([
			'app.jsx',
			'nao.json',
		]);
		const [story] = await db.select().from(s.story);
		expect(story).toMatchObject({ id: storyId });
	});

	it('accepts a query whose SQL was executed in the same chat', async () => {
		await chatQueries.upsertMessage({
			chatId: 'chat-1',
			role: 'assistant',
			parts: [
				buildQueryPart(
					'query_chat',
					{ sqlQuery: 'SELECT 1 AS value' },
					{ columns: ['value'], data: [{ value: 1 }] },
				),
			],
		});

		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Chat query app',
			files: [...APP_FILES, { path: 'data.js', content: 'useQueryData("query_chat")' }],
		});

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ title: 'Chat query app', version: 1 });
	});

	it('updates a published chat-linked story with a query executed in that chat', async () => {
		const created = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Chat query update',
			files: APP_FILES,
		});
		const storyId = created.structuredContent?.id as string;
		await chatQueries.upsertMessage({
			chatId: 'chat-1',
			role: 'assistant',
			parts: [
				buildQueryPart(
					'query_chat_update',
					{ sqlQuery: 'SELECT 2 AS value' },
					{ columns: ['value'], data: [{ value: 2 }] },
				),
			],
		});

		const updated = await call('update_story', {
			story_id: storyId,
			files: [{ path: 'data.js', content: 'useQueryData("query_chat_update")' }],
		});

		expect(updated.isError).toBeUndefined();
		expect(updated.structuredContent).toMatchObject({ id: storyId, version: 2 });
	});

	it('keeps imported query ID constants usable when the query exists in the chat', async () => {
		await chatQueries.upsertMessage({
			chatId: 'chat-1',
			role: 'assistant',
			parts: [
				buildQueryPart(
					'query_chat_import',
					{ sqlQuery: 'SELECT 3 AS value' },
					{ columns: ['value'], data: [{ value: 3 }] },
				),
			],
		});
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Imported query ID',
			files: [
				APP_FILES[0],
				{ path: 'data.js', content: 'export const revenueId = "query_chat_import";' },
				{
					path: 'app.jsx',
					content:
						'import { KpiCard } from "@nao/story-kit"; import { revenueId } from "./data.js"; export default function App() { return <KpiCard queryId={revenueId} />; }',
				},
			],
		});

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({ version: 1 });
	});

	it('gives an actionable runtime error for an imported MCP snapshot ID', async () => {
		const result = await call('create_story', {
			format: 'custom',
			chat_id: 'chat-1',
			title: 'Imported MCP snapshot',
			files: [
				APP_FILES[0],
				{ path: 'data.js', content: 'export const revenueId = "query_mcp";' },
				{
					path: 'app.jsx',
					content:
						'import { KpiCard } from "@nao/story-kit"; import { revenueId } from "./data.js"; export default function App() { return <KpiCard queryId={revenueId} />; }',
				},
			],
		});

		expect(result.isError).toBeUndefined();
		await expect(executeLiveQuery('chat-1', 'query_mcp')).rejects.toThrow(
			'MCP execute_sql results are snapshots, even when chat_id is set',
		);
	});

	it('continues to save MCP query rows in a standalone snapshot', async () => {
		const result = await call('create_story', {
			format: 'custom',
			title: 'MCP snapshot',
			files: [...APP_FILES, { path: 'data.js', content: 'useQueryData("query_mcp")' }],
		});

		expect(result.isError).toBeUndefined();
		const [story] = await db.select().from(s.story);
		const [cache] = await db.select().from(s.storyDataCache);
		expect(cache).toMatchObject({
			storyId: story.id,
			queryData: { query_mcp: { columns: ['value'], data: [{ value: 1 }] } },
		});
	});
});
