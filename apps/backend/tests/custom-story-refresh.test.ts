import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	isCacheExpired: vi.fn(),
	refreshStoryData: vi.fn(),
	executeLiveQuery: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: { BETA_CUSTOM_STORIES_ENABLED: false } }));
vi.mock('../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
}));
vi.mock('../src/queries/activity.queries', () => ({
	getLatestStoryRefreshFailure: mocks.getLatestStoryRefreshFailure,
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueryDataByIds: mocks.getLatestSqlQueryDataByIds,
}));
vi.mock('../src/queries/story-file.queries', () => ({
	getVersionBundle: vi.fn(async () => null),
	listVersionFiles: vi.fn(async () => []),
	storyAppOfBundle: vi.fn(() => null),
}));
vi.mock('../src/queries/story-theme.queries', () => ({ getActiveStoryTheme: vi.fn() }));
vi.mock('../src/utils/story-query-data', () => ({
	extractCustomStoryQueryIds: () => new Set(['query_orders']),
}));
vi.mock('../src/services/live-story', () => ({
	executeLiveQuery: mocks.executeLiveQuery,
	isCacheExpired: mocks.isCacheExpired,
	refreshStoryData: mocks.refreshStoryData,
}));

import { getCustomStoryQueryData, getCustomStoryVersion } from '../src/services/custom-story';

const CACHED_ORDERS = { columns: ['id'], data: [{ id: 1 }] };
const CHAT_ORDERS = { columns: ['id'], data: [{ id: 2 }] };
const REFRESHED_ORDERS = { columns: ['id'], data: [{ id: 3 }] };
const FAILURE = { errorMessage: 'Warehouse unavailable', failedAt: new Date('2026-10-01T10:00:00.000Z') };

describe('custom story background refresh', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			format: 'custom',
			isLive: true,
			isLiveTextDynamic: false,
			cacheSchedule: '0 * * * *',
		});
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1', version: 1, createdAt: new Date() });
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(null);
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_orders: CHAT_ORDERS });
		mocks.refreshStoryData.mockResolvedValue({ queryData: { query_orders: REFRESHED_ORDERS }, narratives: {} });
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

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { deferRefresh: true }),
		).resolves.toEqual(CHAT_ORDERS);
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('serves the expired cache of a story whose last refresh failed without refreshing it', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { query_orders: CACHED_ORDERS },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(true);
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(FAILURE);

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { deferRefresh: true }),
		).resolves.toEqual(CACHED_ORDERS);
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('still refreshes an expired cache inline when no refresh failed', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { query_orders: CACHED_ORDERS },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(true);

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { deferRefresh: true }),
		).resolves.toEqual(REFRESHED_ORDERS);
		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders');
	});
});
