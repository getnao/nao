import { STORY_NARRATIVES_REDACT_MISSING_KEY } from '@nao/shared/story-app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getVersionByNumber: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getStoryViewerDataCache: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	listVersionFiles: vi.fn(),
	hasRowSecurity: vi.fn(),
	isCacheExpired: vi.fn(),
	createStoryExecutionContext: vi.fn(),
	refreshStoryData: vi.fn(),
	executeLiveQuery: vi.fn(),
}));

vi.mock('../../src/env', () => ({ env: { BETA_CUSTOM_STORIES_ENABLED: false } }));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getVersionByNumber: mocks.getVersionByNumber,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	getStoryViewerDataCache: mocks.getStoryViewerDataCache,
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
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeLiveQuery: mocks.executeLiveQuery,
	isCacheExpired: mocks.isCacheExpired,
	refreshStoryData: mocks.refreshStoryData,
	requiresViewerStoryData: mocks.hasRowSecurity,
}));

import {
	getCustomStoryNarratives,
	getCustomStoryQueryData,
	getCustomStoryVersion,
	getSharedCustomStoryQueryData,
} from '../../src/services/custom-story';

const CACHED_ORDERS = { columns: ['id'], data: [{ id: 1 }] };
const CHAT_ORDERS = { columns: ['id'], data: [{ id: 2 }] };
const REFRESHED_ORDERS = { columns: ['id'], data: [{ id: 3 }] };
const FAILURE = { errorMessage: 'Warehouse unavailable', failedAt: new Date('2026-10-01T10:00:00.000Z') };

describe('custom story background refresh', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			slug: 'orders',
			format: 'custom',
			isLive: true,
			isLiveTextDynamic: false,
			cacheSchedule: '0 * * * *',
		});
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1', version: 1, createdAt: new Date() });
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(null);
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_orders: CHAT_ORDERS });
		mocks.listVersionFiles.mockResolvedValue([]);
		mocks.hasRowSecurity.mockResolvedValue(false);
		mocks.createStoryExecutionContext.mockResolvedValue({ permissionRevision: 'permissions-a' });
		mocks.refreshStoryData.mockResolvedValue({ queryData: { query_orders: REFRESHED_ORDERS }, narratives: {} });
		mocks.executeLiveQuery.mockResolvedValue(REFRESHED_ORDERS);
	});

	it('serves a non-live viewer snapshot when row security is configured', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			slug: 'orders',
			format: 'custom',
			isLive: false,
			isLiveTextDynamic: false,
			cacheSchedule: null,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: { query_orders: CACHED_ORDERS },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(false);

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' }),
		).resolves.toEqual(CACHED_ORDERS);

		expect(mocks.getStoryViewerDataCache).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'version-1',
			'viewer-1',
			'permissions-a',
		);
		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	});

	it('reports cached viewer query denials as unavailable', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: { query_orders: { columns: [], data: [], accessDenied: true } },
			cachedAt: new Date(),
		});
		mocks.isCacheExpired.mockReturnValue(false);

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' }),
		).rejects.toThrow('Query data is unavailable with your current access.');
	});

	it('reports stale viewer query denials as unavailable when refresh fails', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: { query_orders: { columns: [], data: [], accessDenied: true } },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(true);
		mocks.refreshStoryData.mockRejectedValue(new Error('Warehouse unavailable'));

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' }),
		).rejects.toThrow('Query data is unavailable with your current access.');

		expect(mocks.executeLiveQuery).not.toHaveBeenCalled();
	});

	it('reads the viewer cache for the requested custom story version', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			slug: 'orders',
			format: 'custom',
			isLive: false,
			isLiveTextDynamic: false,
			cacheSchedule: null,
		});
		mocks.getVersionByNumber.mockResolvedValue({ id: 'version-2' });
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: { query_orders: CACHED_ORDERS },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(false);

		await expect(getSharedCustomStoryQueryData('chat-1', 'orders', 'query_orders', 2, 'viewer-1')).resolves.toEqual(
			CACHED_ORDERS,
		);

		expect(mocks.getVersionByNumber).toHaveBeenCalledWith('chat-1', 'orders', 2);
		expect(mocks.getStoryViewerDataCache).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'version-2',
			'viewer-1',
			'permissions-a',
		);
	});

	it('does not fall back to a viewer cache after permissions change during refresh', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValueOnce({
			queryData: { query_orders: CACHED_ORDERS },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(true);
		mocks.refreshStoryData.mockRejectedValue(new Error('Viewer permissions changed during story refresh'));
		mocks.createStoryExecutionContext
			.mockResolvedValueOnce({ permissionRevision: 'permissions-a' })
			.mockResolvedValueOnce({ permissionRevision: 'permissions-b' });

		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' }),
		).resolves.toEqual(REFRESHED_ORDERS);

		expect(mocks.getStoryViewerDataCache).toHaveBeenLastCalledWith(
			'chat-1',
			'orders',
			'version-1',
			'viewer-1',
			'permissions-b',
		);
	});

	it('does not share an in-flight refresh across permission revisions', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue(null);
		let resolveOldRefresh!: (result: {
			queryData: { query_orders: typeof CACHED_ORDERS };
			narratives: Record<string, string>;
		}) => void;
		mocks.refreshStoryData
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOldRefresh = resolve;
					}),
			)
			.mockResolvedValueOnce({ queryData: { query_orders: REFRESHED_ORDERS }, narratives: {} });

		const oldRequest = getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' });
		await vi.waitFor(() => expect(mocks.refreshStoryData).toHaveBeenCalledTimes(1));

		mocks.createStoryExecutionContext.mockResolvedValue({ permissionRevision: 'permissions-b' });
		await expect(
			getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { viewerUserId: 'viewer-1' }),
		).resolves.toEqual(REFRESHED_ORDERS);
		expect(mocks.refreshStoryData).toHaveBeenCalledTimes(2);

		resolveOldRefresh({ queryData: { query_orders: CACHED_ORDERS }, narratives: {} });
		await expect(oldRequest).resolves.toEqual(REFRESHED_ORDERS);
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
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1' });
		mocks.listVersionFiles.mockResolvedValue([
			{
				path: 'app.tsx',
				content:
					"import { Narrative } from '@nao/story-kit'; export default () => <Narrative id='summary'>Owner narrative</Narrative>;",
			},
		]);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			querySources: null,
			analysisResults: { summary: 'Owner narrative' },
		});

		await expect(getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1' })).resolves.toEqual({
			[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
			summary: '',
		});
		expect(mocks.getStoryDataCacheByStoryId).not.toHaveBeenCalled();
	});

	it('redacts viewer narrative IDs omitted by regeneration', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			slug: 'orders',
			format: 'custom',
			isLive: true,
			isLiveTextDynamic: true,
			cacheSchedule: '0 * * * *',
		});
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1' });
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValue(null);
		mocks.createStoryExecutionContext.mockResolvedValue({ permissionRevision: 'permissions-a' });
		mocks.refreshStoryData.mockResolvedValue({
			queryData: {},
			narratives: { summary: 'Viewer-safe summary' },
		});
		mocks.listVersionFiles.mockResolvedValue([
			{
				path: 'app.tsx',
				content:
					"import { Narrative } from '@nao/story-kit'; const dynamicId = 'dynamic'; export default () => <><Narrative id='summary'>Owner summary</Narrative><Narrative id='detail'>Owner detail</Narrative><Narrative id='rich'><strong>Owner total: 100</strong></Narrative><Narrative id={dynamicId}>Owner dynamic</Narrative></>;",
			},
		]);

		await expect(getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1' })).resolves.toEqual({
			[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
			summary: 'Viewer-safe summary',
			detail: '',
			rich: '',
		});
	});

	it('does not fall back to viewer narratives after permissions change during refresh', async () => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			slug: 'orders',
			format: 'custom',
			isLive: true,
			isLiveTextDynamic: true,
			cacheSchedule: '0 * * * *',
		});
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1' });
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getStoryViewerDataCache.mockResolvedValueOnce({
			queryData: {},
			analysisResults: { summary: 'Revoked rows' },
			cachedAt: new Date(0),
		});
		mocks.isCacheExpired.mockReturnValue(true);
		mocks.refreshStoryData.mockRejectedValue(new Error('Viewer permissions changed during story refresh'));
		mocks.createStoryExecutionContext
			.mockResolvedValueOnce({ permissionRevision: 'permissions-a' })
			.mockResolvedValueOnce({ permissionRevision: 'permissions-b' });

		await expect(getCustomStoryNarratives('chat-1', 'orders', { viewerUserId: 'viewer-1' })).resolves.toEqual({
			[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
		});

		expect(mocks.getStoryViewerDataCache).toHaveBeenLastCalledWith(
			'chat-1',
			'orders',
			'version-1',
			'viewer-1',
			'permissions-b',
		);
	});
});

function getOrdersQueryData() {
	return getCustomStoryQueryData('chat-1', 'orders', 'query_orders', { deferRefresh: true });
}

function mockExpiredOrdersCache(): void {
	mocks.getStoryDataCacheByStoryId.mockResolvedValue({
		queryData: { query_orders: CACHED_ORDERS },
		cachedAt: new Date(0),
	});
	mocks.isCacheExpired.mockReturnValue(true);
}
