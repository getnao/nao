import '../src/env';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import type { ToolResult } from '../src/mcp/logging';
import { registerAssetTools } from '../src/mcp/tools/asset-tools';
import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import * as storyFileQueries from '../src/queries/story-file.queries';

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

	it('requires the ask_nao chat a custom story reads its queries from', async () => {
		const result = await call('create_story', { format: 'custom', title: 'No chat', files: APP_FILES });

		expect(result.isError).toBe(true);
		expect(await db.select().from(s.story)).toHaveLength(0);
	});
});
