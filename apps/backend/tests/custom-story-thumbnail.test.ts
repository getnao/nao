import '../src/env';

import { DEFAULT_DARK_STORY_THEME, DEFAULT_STORY_THEME, type StoryThemePair } from '@nao/shared/story-theme';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import * as storyQueries from '../src/queries/story.queries';
import * as storyFileQueries from '../src/queries/story-file.queries';
import { getCustomStoryThumbnail, queueCustomStoryThumbnail } from '../src/services/custom-story-thumbnail';
import type { StoryScreenshot } from '../src/utils/story-screenshot';

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

const screenshots = vi.hoisted(() => ({
	render: null as unknown as StoryScreenshot,
	darkImage: null as unknown as Buffer,
	brokenModes: [] as string[],
	calls: 0,
}));
vi.mock('../src/utils/story-screenshot', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/utils/story-screenshot')>()),
	renderStoryScreenshot: async (html: string) => {
		screenshots.calls++;
		const isBroken = screenshots.brokenModes.some((mode) => html.includes(`data-mode="${mode}"`));
		if (isBroken) {
			return { ...screenshots.render, blockErrors: ['Something went wrong.'] };
		}
		return html.includes('data-mode="dark"')
			? { ...screenshots.render, image: screenshots.darkImage }
			: screenshots.render;
	},
}));

const documents = vi.hoisted(() => ({ modes: [] as string[] }));
vi.mock('../src/services/custom-story-export', () => ({
	buildCustomStoryDocumentByStoryId: async (
		_storyId: string,
		_version: unknown,
		_queryData: unknown,
		mode: string,
	) => {
		documents.modes.push(mode);
		return `<html data-mode="${mode}"></html>`;
	},
}));
const versionIds = vi.hoisted(() => ({ current: '' }));
const queries = vi.hoisted(() => ({ ids: [] as string[], saved: [] as string[] }));
const themes = vi.hoisted(() => ({ active: null as StoryThemePair | null }));
vi.mock('../src/services/custom-story', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/custom-story')>()),
	getLatestCustomStoryVersionByStoryId: async () => ({
		version: { id: versionIds.current },
		app: { kind: 'react', bundle: 'bundle' },
		queryIds: queries.ids,
		theme: themes.active,
	}),
	getActiveThemeForStory: async () => themes.active,
	getStoredCustomStoryQueryDataByStoryId: async () =>
		Object.fromEntries(queries.saved.map((queryId) => [queryId, { data: [], columns: [] }])),
}));

const STORY_ID = 'story-1';
const STANDALONE_STORY_ID = 'story-standalone';
const LIVE_STORY_ID = 'story-live';

describe('custom story thumbnails', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, chatId: 'chat-1', slug: 'revenue', title: 'Revenue', format: 'custom' });
		await db.insert(s.story).values({
			id: STANDALONE_STORY_ID,
			userId: 'user-1',
			projectId: 'project-1',
			slug: 'standalone',
			title: 'Standalone',
			format: 'custom',
		});
		await db.insert(s.story).values({
			id: LIVE_STORY_ID,
			chatId: 'chat-1',
			slug: 'live',
			title: 'Live',
			format: 'custom',
			isLive: true,
		});
		await db.insert(s.storyDataCache).values({ storyId: LIVE_STORY_ID, queryData: {}, cachedAt: new Date() });
	});

	beforeEach(async () => {
		screenshots.calls = 0;
		screenshots.brokenModes = [];
		screenshots.render = await cleanScreenshot('#ffffff');
		screenshots.darkImage = (await cleanScreenshot('#000000')).image;
		documents.modes = [];
		versionIds.current = await publishVersion();
	});

	afterEach(() => {
		vi.useRealTimers();
		queries.ids = [];
		queries.saved = [];
		themes.active = null;
	});

	it('renders a missing thumbnail in the background, then serves it', async () => {
		const story = await storyQueries.getStoryById(STORY_ID);

		expect(await getCustomStoryThumbnail(story!)).toBeNull();
		const thumbnail = await vi.waitUntil(() => getCustomStoryThumbnail(story!));

		expect(thumbnail.versionId).toBe(versionIds.current);
		expect((await sharp(thumbnail.image).metadata()).format).toBe('webp');
		expect(documents.modes).toEqual(['light', 'dark']);
	});

	it('renders a queued version before anyone asks for it', async () => {
		queueCustomStoryThumbnail(STORY_ID, versionIds.current);

		await vi.waitUntil(() => storyFileQueries.getVersionThumbnail(versionIds.current));
		expect(screenshots.calls).toBe(2);
	});

	it('renders thumbnails for standalone custom stories', async () => {
		versionIds.current = await publishVersion(STANDALONE_STORY_ID);
		const story = await storyQueries.getStoryById(STANDALONE_STORY_ID);

		expect(await getCustomStoryThumbnail(story!)).toBeNull();
		const thumbnail = await vi.waitUntil(() => getCustomStoryThumbnail(story!));

		expect(thumbnail.versionId).toBe(versionIds.current);
		expect(screenshots.calls).toBe(2);
	});

	it('retries a broken render a few times, then never renders it again', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		screenshots.brokenModes = ['light', 'dark'];
		const story = await storyQueries.getStoryById(STORY_ID);

		for (const attempt of [1, 2, 3]) {
			await getCustomStoryThumbnail(story!);
			await vi.waitUntil(() => screenshots.calls === attempt * 2);
			await getCustomStoryThumbnail(story!);
			await settle();
			expect(screenshots.calls).toBe(attempt * 2);
			vi.setSystemTime(Date.now() + 3 * 60 * 1000);
		}
		await vi.waitUntil(async () => (await storyFileQueries.getVersionThumbnail(versionIds.current)) !== null);
		await getCustomStoryThumbnail(story!);
		await settle();

		expect(screenshots.calls).toBe(6);
		expect(await getCustomStoryThumbnail(story!)).toBeNull();
		expect(await getCustomStoryThumbnail(story!, 'dark')).toBeNull();
	});

	it('keeps the light thumbnail of a story that renders broken only in dark mode', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		screenshots.brokenModes = ['dark'];
		const story = await storyQueries.getStoryById(STORY_ID);

		const light = await vi.waitUntil(() => getCustomStoryThumbnail(story!));
		expect(light.isCurrent).toBe(false);
		for (const attempt of [2, 3]) {
			vi.setSystemTime(Date.now() + 3 * 60 * 1000);
			await getCustomStoryThumbnail(story!);
			await vi.waitUntil(() => documents.modes.filter((mode) => mode === 'dark').length === attempt);
		}
		const settled = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});

		expect(documents.modes).toEqual(['light', 'dark', 'dark', 'dark']);
		expect(settled.image).toEqual(light.image);
		expect(await getCustomStoryThumbnail(story!, 'dark')).toBeNull();
	});

	it('waits for missing query results without rendering nor giving up, and never runs a query', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		queries.ids = ['query_1'];
		const story = await storyQueries.getStoryById(STORY_ID);

		for (let attempt = 0; attempt < 5; attempt++) {
			await getCustomStoryThumbnail(story!);
			await settle();
			vi.setSystemTime(Date.now() + 3 * 60 * 1000);
		}
		expect(screenshots.calls).toBe(0);
		expect(await storyFileQueries.getVersionThumbnail(versionIds.current)).toBeNull();

		queries.saved = ['query_1'];
		await getCustomStoryThumbnail(story!);
		await vi.waitUntil(() => storyFileQueries.getVersionThumbnail(versionIds.current));
		expect(screenshots.calls).toBe(2);
	});

	it('serves the thumbnail matching the requested theme mode', async () => {
		const story = await storyQueries.getStoryById(STORY_ID);

		expect(await getCustomStoryThumbnail(story!, 'dark')).toBeNull();
		const dark = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!, 'dark');
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});
		const light = await getCustomStoryThumbnail(story!, 'light');

		expect(dark.image).not.toEqual(light!.image);
		expect(screenshots.calls).toBe(2);
	});

	it('serves the previous image after a theme change while it renders the new one', async () => {
		const story = await storyQueries.getStoryById(STORY_ID);
		await getCustomStoryThumbnail(story!);
		const before = await vi.waitUntil(() => getCustomStoryThumbnail(story!));

		themes.active = {
			light: DEFAULT_STORY_THEME,
			dark: { ...DEFAULT_DARK_STORY_THEME, accent: { ...DEFAULT_DARK_STORY_THEME.accent, color: '#ff0000' } },
		} as StoryThemePair;
		const stale = await getCustomStoryThumbnail(story!);
		const after = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});

		expect(stale).toMatchObject({ isCurrent: false, renderKey: before.renderKey });
		expect(after.renderKey).not.toBe(before.renderKey);
		expect(screenshots.calls).toBe(4);
	});

	it('renders a live story again once its data is refreshed', async () => {
		versionIds.current = await publishVersion(LIVE_STORY_ID);
		const story = await storyQueries.getStoryById(LIVE_STORY_ID);
		const before = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});

		await db
			.update(s.storyDataCache)
			.set({ cachedAt: new Date(Date.now() + 60_000) })
			.where(eq(s.storyDataCache.storyId, LIVE_STORY_ID));
		const stale = await getCustomStoryThumbnail(story!);
		const after = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});

		expect(stale?.isCurrent).toBe(false);
		expect(after.renderKey).not.toBe(before.renderKey);
		expect(screenshots.calls).toBe(4);
	});

	it('drops the thumbnail when its version is rebuilt', async () => {
		await storyFileQueries.setVersionThumbnail(versionIds.current, 'old', 'theme');

		await storyFileQueries.setVersionBundle(versionIds.current, { kind: 'react', bundle: 'rebuilt' });

		expect(await storyFileQueries.getVersionThumbnail(versionIds.current)).toBeNull();
	});
});

async function publishVersion(storyId = STORY_ID): Promise<string> {
	const versions = await db.select().from(s.storyVersion);
	const [version] = await db
		.insert(s.storyVersion)
		.values({ storyId, version: versions.length + 1, code: '', action: 'publish', source: 'assistant' })
		.returning();
	await storyFileQueries.setVersionBundle(version.id, { kind: 'react', bundle: 'bundle' });
	return version.id;
}

async function cleanScreenshot(background: string): Promise<StoryScreenshot> {
	const image = await sharp({ create: { width: 1280, height: 800, channels: 3, background } })
		.png()
		.toBuffer();
	return { ready: true, blank: false, runtimeErrors: [], blockErrors: [], image };
}

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 50));
}
