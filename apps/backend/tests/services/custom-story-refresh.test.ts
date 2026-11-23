import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { STORY_NARRATIVES_REDACT_MISSING_KEY } from '@nao/shared/story-app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getVersionByNumber: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	listVersionFiles: vi.fn(),
	resolveRestrictedViewerId: vi.fn(),
	loadViewerStorySnapshot: vi.fn(),
	blankViewerNarratives: vi.fn(),
	isCacheExpired: vi.fn(),
	refreshStoryData: vi.fn(),
	executeLiveQuery: vi.fn(),
}));

vi.mock('../../src/env', () => ({ env: { BETA_CUSTOM_STORIES_ENABLED: false } }));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getVersionByNumber: mocks.getVersionByNumber,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
}));
vi.mock('../../src/queries/activity.queries', () => ({
	getLatestStoryRefreshFailure: mocks.getLatestStoryRefreshFailure,
}));
vi.mock('../../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueryDataByIds: mocks.getLatestSqlQueryDataByIds,
}));
vi.mock('../../src/queries/story-file.queries', () => ({
	getVersionBundle: vi.fn(async () => null),
	listVersionFiles: mocks.listVersionFiles,
	storyAppOfBundle: vi.fn(() => null),
}));
vi.mock('../../src/queries/story-theme.queries', () => ({ getActiveStoryTheme: vi.fn() }));
vi.mock('../../src/utils/story-query-data', () => ({
	extractCustomStoryQueryIds: () => new Set(['query_orders']),
}));
vi.mock('../../src/services/live-story', () => ({
	blankViewerNarratives: mocks.blankViewerNarratives,
	executeLiveQuery: mocks.executeLiveQuery,
	isCacheExpired: mocks.isCacheExpired,
	loadViewerStorySnapshot: mocks.loadViewerStorySnapshot,
	refreshStoryData: mocks.refreshStoryData,
	resolveRestrictedViewerId: mocks.resolveRestrictedViewerId,
}));

import {
	getCustomStoryNarratives,
	getCustomStoryQueryData,
	getCustomStoryVersion,
	getSharedCustomStoryQueryData,
} from '../../src/services/custom-story';
import type { ViewerStorySnapshot } from '../../src/services/live-story';

const LIVE_STORY = {
	id: 'story-1',
	slug: 'orders',
	format: 'custom',
	isLive: true,
	isLiveTextDynamic: false,
	cacheSchedule: '0 * * * *',
};
const FROZEN_STORY = { ...LIVE_STORY, isLive: false, cacheSchedule: null };
const DYNAMIC_TEXT_STORY = { ...LIVE_STORY, isLiveTextDynamic: true };
const VIEWER_REQUEST = { chatId: 'chat-1', slug: 'orders', viewerUserId: 'viewer-1' };
const CACHED_ORDERS = { columns: ['id'], data: [{ id: 1 }] };
const CHAT_ORDERS = { columns: ['id'], data: [{ id: 2 }] };
const REFRESHED_ORDERS = { columns: ['id'], data: [{ id: 3 }] };
const FAILURE = { errorMessage: 'Warehouse unavailable', failedAt: new Date('2026-10-01T10:00:00.000Z') };

describe('custom story background refresh', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue(LIVE_STORY);
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1', version: 1, createdAt: new Date() });
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(null);
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_orders: CHAT_ORDERS });
		mocks.listVersionFiles.mockResolvedValue([]);
		mocks.resolveRestrictedViewerId.mockResolvedValue(undefined);
		mocks.refreshStoryData.mockResolvedValue({ queryData: { query_orders: REFRESHED_ORDERS }, narratives: {} });
		mocks.executeLiveQuery.mockResolvedValue(REFRESHED_ORDERS);
	});

	it('serves a non-live viewer snapshot when row security is configured', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue(FROZEN_STORY);
		mockViewerSnapshot({ queryData: { query_orders: CACHED_ORDERS } });

		await expect(getViewerOrdersQueryData()).resolves.toEqual(CACHED_ORDERS);

		expect(mocks.resolveRestrictedViewerId).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.loadViewerStorySnapshot).toHaveBeenCalledWith(VIEWER_REQUEST, expect.any(Function));
		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('keeps a viewer snapshot only until the cache schedule of the story expires it', async () => {
		mockViewerSnapshot({ queryData: { query_orders: CACHED_ORDERS } });
		await getViewerOrdersQueryData();
		const [, isUsable] = mocks.loadViewerStorySnapshot.mock.calls[0];

		mocks.isCacheExpired.mockReturnValue(false);
		expect(isUsable({ cachedAt: new Date(0) })).toBe(true);
		mocks.isCacheExpired.mockReturnValue(true);
		expect(isUsable({ cachedAt: new Date(0) })).toBe(false);
		expect(mocks.isCacheExpired).toHaveBeenCalledWith(new Date(0), LIVE_STORY.cacheSchedule);
	});

	it('reports viewer query denials as unavailable', async () => {
		mockViewerSnapshot({ queryData: { query_orders: { columns: [], data: [], accessDenied: true } } });

		await expect(getViewerOrdersQueryData()).rejects.toThrow('Query data is unavailable with your current access.');

		expect(mocks.executeLiveQuery).not.toHaveBeenCalled();
	});

	it('reads the viewer snapshot of the requested custom story version', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue(FROZEN_STORY);
		mocks.getVersionByNumber.mockResolvedValue({ id: 'version-2' });
		mockViewerSnapshot({ queryData: { query_orders: CACHED_ORDERS } });

		await expect(getSharedCustomStoryQueryData('chat-1', 'orders', 'query_orders', 2, 'viewer-1')).resolves.toEqual(
			CACHED_ORDERS,
		);

		expect(mocks.getVersionByNumber).toHaveBeenCalledWith('chat-1', 'orders', 2);
		expect(mocks.loadViewerStorySnapshot).toHaveBeenCalledWith(
			{ ...VIEWER_REQUEST, storyVersionId: 'version-2' },
			expect.any(Function),
		);
	});

	it('runs the query as the viewer when the viewer snapshot cannot be built', async () => {
		mockFailedViewerSnapshot();

		await expect(getViewerOrdersQueryData()).resolves.toEqual(REFRESHED_ORDERS);

		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'query_orders', { viewerUserId: 'viewer-1' });
		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
	});

	it('runs the query as the viewer when the viewer snapshot lacks it', async () => {
		mockViewerSnapshot();

		await expect(getViewerOrdersQueryData()).resolves.toEqual(REFRESHED_ORDERS);

		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'query_orders', { viewerUserId: 'viewer-1' });
	});

	it('runs the query as the viewer without a snapshot when the story never caches', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({ ...LIVE_STORY, cacheSchedule: NO_CACHE_SCHEDULE });
		mockViewerSnapshot({ queryData: { query_orders: CACHED_ORDERS } });

		await expect(getViewerOrdersQueryData()).resolves.toEqual(REFRESHED_ORDERS);

		expect(mocks.loadViewerStorySnapshot).not.toHaveBeenCalled();
		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'query_orders', { viewerUserId: 'viewer-1' });
	});

	it.each([
		['was never cached', null, false, null, true],
		['has a fresh cache', { queryData: {} }, false, null, false],
		['has an expired cache', { queryData: {} }, true, null, false],
		['has an expired cache after a failed refresh', { queryData: {} }, true, FAILURE, true],
	])(
		'reports whether a story that %s needs a background refresh',
		async (_label, cache, expired, failure, expected) => {
			mocks.getStoryDataCacheByStoryId.mockResolvedValue(cache && { ...cache, cachedAt: new Date() });
			mocks.isCacheExpired.mockReturnValue(expired);
			mocks.getLatestStoryRefreshFailure.mockResolvedValue(failure);

			const view = await getCustomStoryVersion('chat-1', 'orders');

			expect(view.needsRefresh).toBe(expected);
		},
	);

	it('serves the chat data of a never-cached story without refreshing it', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue(null);

		await expect(getOrdersQueryData()).resolves.toEqual(CHAT_ORDERS);
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('serves the expired cache of a story whose last refresh failed without refreshing it', async () => {
		mockExpiredOrdersCache();
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(FAILURE);

		await expect(getOrdersQueryData()).resolves.toEqual(CACHED_ORDERS);
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('still refreshes an expired cache inline when no refresh failed', async () => {
		mockExpiredOrdersCache();

		await expect(getOrdersQueryData()).resolves.toEqual(REFRESHED_ORDERS);
		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders');
	});
});

describe('custom story narratives once the story is not live', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', format: 'custom', isLive: false });
		mocks.listVersionFiles.mockResolvedValue([]);
	});

	it('serves the narratives frozen into a copy of a live story', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			querySources: null,
			analysisResults: { summary: 'Frozen narrative' },
		});

		await expect(getCustomStoryNarratives('chat-1', 'orders')).resolves.toEqual({ summary: 'Frozen narrative' });
	});

	it('ignores the narratives left over from its own live refreshes', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			querySources: { query_orders: { sqlQuery: 'select 1' } },
			analysisResults: { summary: 'Old live narrative' },
		});

		await expect(getCustomStoryNarratives('chat-1', 'orders')).resolves.toEqual({});
	});

	it('does not expose frozen owner narratives to an RLS viewer', async () => {
		const blankNarratives = { [STORY_NARRATIVES_REDACT_MISSING_KEY]: '', summary: '' };
		mocks.resolveRestrictedViewerId.mockResolvedValue('viewer-1');
		mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'version-1' });
		mocks.blankViewerNarratives.mockResolvedValue(blankNarratives);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			querySources: null,
			analysisResults: { summary: 'Owner narrative' },
		});

		await expect(getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1' })).resolves.toEqual(
			blankNarratives,
		);

		expect(mocks.blankViewerNarratives).toHaveBeenCalledWith('version-1');
		expect(mocks.getStoryDataCacheByStoryId).not.toHaveBeenCalled();
		expect(mocks.loadViewerStorySnapshot).not.toHaveBeenCalled();
	});

	it('serves the narratives of the viewer snapshot of the requested version when the text is dynamic', async () => {
		const viewerNarratives = {
			[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
			summary: 'Viewer-safe summary',
			detail: '',
		};
		mocks.getStoryByChatAndSlug.mockResolvedValue(DYNAMIC_TEXT_STORY);
		mockViewerSnapshot({ narratives: viewerNarratives });

		await expect(
			getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1', storyVersionId: 'version-2' }),
		).resolves.toEqual(viewerNarratives);

		expect(mocks.loadViewerStorySnapshot).toHaveBeenCalledWith(
			{ ...VIEWER_REQUEST, storyVersionId: 'version-2' },
			expect.any(Function),
		);
		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
		expect(mocks.blankViewerNarratives).not.toHaveBeenCalled();
	});

	it('blanks the narratives when the viewer snapshot cannot be built', async () => {
		const blankNarratives = { [STORY_NARRATIVES_REDACT_MISSING_KEY]: '' };
		mocks.getStoryByChatAndSlug.mockResolvedValue(DYNAMIC_TEXT_STORY);
		mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'version-1' });
		mocks.blankViewerNarratives.mockResolvedValue(blankNarratives);
		mockFailedViewerSnapshot();

		await expect(getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1' })).resolves.toEqual(
			blankNarratives,
		);

		expect(mocks.blankViewerNarratives).toHaveBeenCalledWith('version-1');
		expect(mocks.getStoryDataCacheByStoryId).not.toHaveBeenCalled();
	});
});

function getOrdersQueryData() {
	return getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { deferRefresh: true });
}

function getViewerOrdersQueryData() {
	return getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' });
}

function mockViewerSnapshot(snapshot: Partial<ViewerStorySnapshot> = {}): void {
	mocks.resolveRestrictedViewerId.mockResolvedValue('viewer-1');
	mocks.loadViewerStorySnapshot.mockResolvedValue({
		queryData: {},
		narratives: {},
		code: '',
		cachedAt: new Date(0),
		...snapshot,
	});
}

function mockFailedViewerSnapshot(): void {
	mocks.resolveRestrictedViewerId.mockResolvedValue('viewer-1');
	mocks.loadViewerStorySnapshot.mockRejectedValue(new Error('Warehouse unavailable'));
}

function mockExpiredOrdersCache(): void {
	mocks.getStoryDataCacheByStoryId.mockResolvedValue({
		queryData: { query_orders: CACHED_ORDERS },
		cachedAt: new Date(0),
	});
	mocks.isCacheExpired.mockReturnValue(true);
}
