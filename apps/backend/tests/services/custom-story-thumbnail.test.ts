import '../../src/env';

import { DEFAULT_DARK_STORY_THEME, DEFAULT_STORY_THEME, type StoryThemePair } from '@nao/shared/story-theme';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as projectQueries from '../../src/queries/project.queries';
import * as storyQueries from '../../src/queries/story.queries';
import * as storyFileQueries from '../../src/queries/story-file.queries';
import {
	canShowStoredCustomStoryThumbnail,
	getCustomStoryThumbnail,
	getViewerCustomStoryThumbnail,
	queueCustomStoryThumbnail,
} from '../../src/services/custom-story-thumbnail';
import type { ViewerStoryRequest, ViewerStorySnapshot } from '../../src/services/live-story';
import type { StoryScreenshot } from '../../src/utils/story-screenshot';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const screenshots = vi.hoisted(() => ({
	render: null as unknown as StoryScreenshot,
	darkImage: null as unknown as Buffer,
	brokenModes: [] as string[],
	calls: 0,
	activeCalls: 0,
	maxActiveCalls: 0,
	delayMs: 0,
}));
vi.mock('../../src/utils/story-screenshot', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/utils/story-screenshot')>()),
	renderStoryScreenshot: async (html: string) => {
		screenshots.calls++;
		screenshots.activeCalls++;
		screenshots.maxActiveCalls = Math.max(screenshots.maxActiveCalls, screenshots.activeCalls);
		try {
			if (screenshots.delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, screenshots.delayMs));
			}
			const isBroken = screenshots.brokenModes.some((mode) => html.includes(`data-mode="${mode}"`));
			if (isBroken) {
				return { ...screenshots.render, blockErrors: ['Something went wrong.'] };
			}
			return html.includes('data-mode="dark"')
				? { ...screenshots.render, image: screenshots.darkImage }
				: screenshots.render;
		} finally {
			screenshots.activeCalls--;
		}
	},
}));

const documents = vi.hoisted(() => ({
	modes: [] as string[],
	queryData: [] as Record<string, unknown>[],
	options: [] as unknown[],
}));
vi.mock('../../src/services/custom-story-export', () => ({
	buildCustomStoryDocumentByStoryId: async (
		_storyId: string,
		_version: unknown,
		queryData: Record<string, unknown>,
		mode: string,
		options?: unknown,
	) => {
		documents.modes.push(mode);
		documents.queryData.push(queryData);
		documents.options.push(options);
		return `<html data-mode="${mode}"></html>`;
	},
}));
const versionIds = vi.hoisted(() => ({ current: '' }));
const queries = vi.hoisted(() => ({ ids: [] as string[], saved: [] as string[] }));
const themes = vi.hoisted(() => ({ active: null as StoryThemePair | null }));
const viewer = vi.hoisted(() => ({
	snapshot: null as unknown as ViewerStorySnapshot,
	error: null as Error | null,
	gate: null as Promise<void> | null,
	gateSlug: null as string | null,
	requests: [] as ViewerStoryRequest[],
}));
vi.mock('../../src/services/custom-story', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../src/services/custom-story')>();
	return {
		...original,
		getLatestCustomStoryVersionByStoryId: async () => {
			if (!versionIds.current) {
				throw new original.CustomStoryNotFoundError();
			}
			return {
				version: { id: versionIds.current },
				app: { kind: 'react', bundle: 'bundle' },
				queryIds: queries.ids,
				theme: themes.active,
			};
		},
		getActiveThemeForStory: async () => themes.active,
		getStoredCustomStoryQueryDataByStoryId: async () =>
			Object.fromEntries(queries.saved.map((queryId) => [queryId, { data: [], columns: [] }])),
	};
});
vi.mock('../../src/services/custom-story-state', () => ({
	getCustomStoryStateByStoryId: async () => ({ shared: {}, own: {} }),
}));
vi.mock('../../src/services/live-story', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/live-story')>()),
	loadViewerStorySnapshot: async (request: ViewerStoryRequest) => {
		viewer.requests.push(request);
		if (viewer.gate && viewer.gateSlug === request.slug) {
			await viewer.gate;
		}
		if (viewer.error) {
			throw viewer.error;
		}
		return viewer.snapshot;
	},
}));

const STORY_ID = 'story-1';
const STANDALONE_STORY_ID = 'story-standalone';
const LIVE_STORY_ID = 'story-live';

describe('custom story thumbnails', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: 'user-1', name: 'User', email: 'user@example.com' },
			{ id: 'user-2', name: 'Viewer', email: 'viewer@example.com' },
		]);
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.projectMember).values({ projectId: 'project-1', userId: 'user-2', role: 'viewer' });
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
		await db
			.update(s.project)
			.set({ rowSecurity: { version: 1, tables: [] } })
			.where(eq(s.project.id, 'project-1'));
		screenshots.calls = 0;
		screenshots.activeCalls = 0;
		screenshots.maxActiveCalls = 0;
		screenshots.delayMs = 0;
		screenshots.brokenModes = [];
		screenshots.render = await cleanScreenshot('#ffffff');
		screenshots.darkImage = (await cleanScreenshot('#000000')).image;
		documents.modes = [];
		documents.queryData = [];
		documents.options = [];
		viewer.snapshot = { queryData: {}, narratives: {}, code: '', cachedAt: new Date('2026-10-01T10:00:00.000Z') };
		viewer.error = null;
		viewer.gate = null;
		viewer.gateSlug = null;
		viewer.requests = [];
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

	it('renders restricted thumbnails from the viewer snapshot of the story', async () => {
		queries.ids = ['orders'];
		viewer.snapshot = {
			...viewer.snapshot,
			queryData: { orders: { data: [{ total: 12 }], columns: ['total'] } },
			narratives: { summary: 'Viewer-safe summary' },
		};
		const story = await storyQueries.getStoryById(STORY_ID);

		const thumbnail = await getViewerCustomStoryThumbnail(story!, 'user-2');

		expect((await sharp(thumbnail!).metadata()).format).toBe('webp');
		expect(viewer.requests).toEqual([
			{ chatId: 'chat-1', slug: 'revenue', storyVersionId: versionIds.current, viewerUserId: 'user-2' },
		]);
		expect(documents.queryData).toEqual([viewer.snapshot.queryData]);
		expect(documents.options).toEqual([expect.objectContaining({ narratives: viewer.snapshot.narratives })]);
	});

	it('renders only one viewer thumbnail at a time', async () => {
		screenshots.delayMs = 25;
		const story = await storyQueries.getStoryById(STORY_ID);

		const thumbnails = await Promise.all([
			getViewerCustomStoryThumbnail(story!, 'user-2', 'light'),
			getViewerCustomStoryThumbnail(story!, 'user-2', 'dark'),
		]);

		expect(thumbnails.every((thumbnail) => thumbnail !== null)).toBe(true);
		expect(screenshots.calls).toBe(2);
		expect(screenshots.maxActiveCalls).toBe(1);
	});

	it('does not let slow viewer data preparation block a ready screenshot', async () => {
		let releaseSnapshot!: () => void;
		viewer.gateSlug = 'revenue';
		viewer.gate = new Promise((resolve) => {
			releaseSnapshot = resolve;
		});
		const slowStory = await storyQueries.getStoryById(STORY_ID);
		const readyStory = await storyQueries.getStoryById(LIVE_STORY_ID);

		const slowThumbnail = getViewerCustomStoryThumbnail(slowStory!, 'user-2', 'light');
		await vi.waitUntil(() => viewer.requests.some(({ slug }) => slug === 'revenue'));
		const readyThumbnail = getViewerCustomStoryThumbnail(readyStory!, 'user-2', 'dark');

		await vi.waitUntil(() => screenshots.calls === 1);
		expect(documents.modes).toEqual(['dark']);

		releaseSnapshot();
		await expect(Promise.all([slowThumbnail, readyThumbnail])).resolves.toHaveLength(2);
		expect(screenshots.calls).toBe(2);
		expect(screenshots.maxActiveCalls).toBe(1);
	});

	it('renders restricted thumbnails with a safe result for denied queries', async () => {
		queries.ids = ['orders'];
		viewer.snapshot = {
			...viewer.snapshot,
			queryData: { orders: { columns: [], data: [], accessDenied: true } },
		};
		const story = await storyQueries.getStoryById(STORY_ID);

		const thumbnail = await getViewerCustomStoryThumbnail(story!, 'user-2');

		expect(thumbnail).not.toBeNull();
		expect(documents.queryData).toContainEqual({
			orders: { columns: [], data: [], accessDenied: true },
		});
	});

	it('does not render viewer thumbnails for standalone stories', async () => {
		const story = await storyQueries.getStoryById(STANDALONE_STORY_ID);

		await expect(getViewerCustomStoryThumbnail(story!, 'user-2')).resolves.toBeNull();
	});

	it('does not render viewer thumbnails without a published version', async () => {
		versionIds.current = '';
		const story = await storyQueries.getStoryById(STORY_ID);

		await expect(getViewerCustomStoryThumbnail(story!, 'user-2')).resolves.toBeNull();
	});

	it('shares one render between concurrent requests for the same viewer thumbnail', async () => {
		screenshots.delayMs = 25;
		const story = await storyQueries.getStoryById(STORY_ID);

		const [first, second] = await Promise.all([
			getViewerCustomStoryThumbnail(story!, 'user-2'),
			getViewerCustomStoryThumbnail(story!, 'user-2'),
		]);

		expect(first).not.toBeNull();
		expect(second).toBe(first);
		expect(viewer.requests).toHaveLength(1);
		expect(screenshots.calls).toBe(1);
	});

	it('reuses a viewer thumbnail until the viewer snapshot changes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const story = await storyQueries.getStoryById(STORY_ID);

		const first = await getViewerCustomStoryThumbnail(story!, 'user-2');
		vi.setSystemTime(Date.now() + 10 * 60 * 1000);
		const reused = await getViewerCustomStoryThumbnail(story!, 'user-2');

		expect(reused).toBe(first);
		expect(viewer.requests).toHaveLength(2);
		expect(screenshots.calls).toBe(1);

		viewer.snapshot = { ...viewer.snapshot, cachedAt: new Date(viewer.snapshot.cachedAt.getTime() + 1000) };
		const rendered = await getViewerCustomStoryThumbnail(story!, 'user-2');

		expect(rendered).not.toBeNull();
		expect(screenshots.calls).toBe(2);
	});

	it.each([
		[
			'a broken render',
			() => {
				screenshots.brokenModes = ['light'];
			},
		],
		[
			'a failed snapshot',
			() => {
				viewer.error = new Error('Warehouse unavailable');
			},
		],
	])('waits out the cool-down before retrying a viewer thumbnail after %s', async (_label, breakThumbnail) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		breakThumbnail();
		const story = await storyQueries.getStoryById(STORY_ID);

		await expect(getViewerCustomStoryThumbnail(story!, 'user-2')).resolves.toBeNull();
		screenshots.brokenModes = [];
		viewer.error = null;
		vi.setSystemTime(Date.now() + 60 * 1000);

		await expect(getViewerCustomStoryThumbnail(story!, 'user-2')).resolves.toBeNull();
		expect(viewer.requests).toHaveLength(1);

		vi.setSystemTime(Date.now() + 61 * 1000);

		await expect(getViewerCustomStoryThumbnail(story!, 'user-2')).resolves.not.toBeNull();
		expect(viewer.requests).toHaveLength(2);
	});

	it('hides stored thumbnails from restricted non-owners', async () => {
		await expect(canShowStoredCustomStoryThumbnail(STORY_ID, 'user-2')).resolves.toBe(false);
		await db
			.update(s.project)
			.set({
				rowSecurity: {
					version: 1,
					tables: [
						{
							databaseType: 'duckdb',
							database: 'analytics',
							schema: 'main',
							table: 'orders',
							constraintColumns: ['tenant_id'],
						},
					],
				},
			})
			.where(eq(s.project.id, 'project-1'));

		await expect(canShowStoredCustomStoryThumbnail(STORY_ID, 'user-1')).resolves.toBe(true);
		await expect(canShowStoredCustomStoryThumbnail(STORY_ID, 'user-2')).resolves.toBe(false);
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

	it('renders again once a boundary set of its project changes', async () => {
		const story = await storyQueries.getStoryById(STORY_ID);
		const before = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});

		await projectQueries.addCustomBoundary('project-1', {
			key: 'regions',
			label: 'Regions',
			url: 'https://example.com/regions.geojson',
			joinProperty: 'code',
			regionKeyHint: 'Region code',
		});
		const stale = await getCustomStoryThumbnail(story!);
		const after = await vi.waitUntil(async () => {
			const thumbnail = await getCustomStoryThumbnail(story!);
			return thumbnail?.isCurrent ? thumbnail : undefined;
		});
		await projectQueries.deleteCustomBoundary('project-1', 'regions');

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
