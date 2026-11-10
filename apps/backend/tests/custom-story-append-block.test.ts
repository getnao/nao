import '../src/env';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import * as storyFileQueries from '../src/queries/story-file.queries';
import { appendCustomStoryBlock, StoryBlockEditError } from '../src/services/story-block-edit';

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

vi.mock('../src/services/story-app-build', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/story-app-build')>()),
	buildStoryApp: async () => ({ ok: true, app: { kind: 'react', bundle: 'bundle' }, entry: 'app.jsx' }),
}));

vi.mock('../src/services/custom-story-thumbnail', () => ({ queueCustomStoryThumbnail: () => {} }));

const STORY_ID = 'story-1';
const APP_SOURCE = `import { KpiCard } from "@nao/story-kit";

export default function App() {
  return (
    <main>
      <KpiCard queryId="query_1" title="Revenue" />
    </main>
  );
}
`;
const PLUGIN_CHART = {
	component: 'Chart' as const,
	props: { queryId: 'query_2', type: 'ouistiti', title: 'Top customers', xKey: 'customer' },
};

describe('appending a chart to a custom story', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, chatId: 'chat-1', slug: 'revenue', title: 'Revenue', format: 'custom' });
	});

	beforeEach(async () => {
		await db.delete(s.storyVersion);
		await db.delete(s.storyDraftFile);
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: APP_SOURCE });
		await storyFileQueries.cutVersionFromDraft({
			storyId: STORY_ID,
			action: 'publish',
			source: 'assistant',
			origin: 'agent',
			authorId: 'user-1',
			sourceChatId: 'chat-1',
		});
	});

	it('publishes a new version whose layout ends with the chart', async () => {
		const result = await appendChart();

		expect(result).toEqual({ version: 2 });
		const [published] = await storyFileQueries.listVersionFiles(await latestVersionId());
		expect(published.content).toMatch(
			/<KpiCard queryId="query_1" title="Revenue" \/>\s*<Chart\s+queryId="query_2"\s+type="ouistiti"[\s\S]*\/>\s*<\/main>/,
		);
		expect(published.content).toContain('import { KpiCard, Chart } from "@nao/story-kit";');
	});

	it('leaves the story alone while the agent has unpublished changes', async () => {
		await storyFileQueries.writeDraftFile(STORY_ID, { path: 'app.jsx', content: `${APP_SOURCE}\n// wip\n` });

		await expect(appendChart()).rejects.toBeInstanceOf(StoryBlockEditError);
		expect(await db.select().from(s.storyVersion)).toHaveLength(1);
	});
});

function appendChart() {
	return appendCustomStoryBlock({
		chatId: 'chat-1',
		authorId: 'user-1',
		storySlug: 'revenue',
		versionNumber: 1,
		block: PLUGIN_CHART,
	});
}

async function latestVersionId(): Promise<string> {
	const versions = await db.select().from(s.storyVersion);
	return versions.reduce((latest, version) => (version.version > latest.version ? version : latest)).id;
}
