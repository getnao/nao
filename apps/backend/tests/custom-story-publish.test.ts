import '../src/env';

import type { Tool } from 'ai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import storyTool from '../src/agents/tools/story';
import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import * as storyFileQueries from '../src/queries/story-file.queries';
import type { ToolContext } from '../src/types/tools';

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

vi.mock('../src/services/story-mount', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/story-mount')>()),
	isCustomStoriesEnabled: () => true,
	customStoryAuthoringError: () => null,
}));

const onBuild = vi.hoisted(() => ({ current: async () => {} }));
vi.mock('../src/services/story-app-build', () => ({
	buildStoryApp: async () => {
		await onBuild.current();
		return { ok: true, app: { kind: 'react', bundle: 'bundle' }, entry: 'app.tsx' };
	},
}));

const STORY_ID = 'story-1';

describe('publishing a custom story', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, chatId: 'chat-1', slug: 'revenue', title: 'Revenue', format: 'custom' });
	});

	beforeEach(async () => {
		onBuild.current = async () => {};
		await db.delete(s.storyVersion);
		await db.delete(s.storyDraftFile);
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: 'export default () => null;' });
	});

	it('publishes the draft it built, with its bundle', async () => {
		const output = await publish();

		expect(output).toMatchObject({ success: true, version: 1 });
		expect(await db.select().from(s.storyBundle)).toHaveLength(1);
		expect(await db.select().from(s.storyFolderItem)).toHaveLength(1);
	});

	it('refuses to publish when the draft changes during the build', async () => {
		onBuild.current = async () => {
			await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: 'export default () => 1;' });
		};

		const output = await publish();

		expect(output).toMatchObject({ success: false, error: expect.stringContaining('draft changed') });
		expect(await db.select().from(s.storyVersion)).toEqual([]);
	});
});

function publish() {
	const tool = storyTool as Tool<{ action: 'publish'; id: string }, { success: boolean }>;
	return tool.execute!({ action: 'publish', id: 'revenue' }, {
		experimental_context: {
			chatId: 'chat-1',
			userId: 'user-1',
			projectId: 'project-1',
			userGroupFeatures: ['storyCreation', 'customStoryCreation'],
			generatedArtifacts: { stories: [] },
		} as unknown as ToolContext,
	} as Parameters<NonNullable<typeof tool.execute>>[1]);
}
