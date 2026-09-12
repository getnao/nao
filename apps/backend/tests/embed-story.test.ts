import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	verifyEmbedToken: vi.fn(),
	assertProjectMcpEnabled: vi.fn(),
	getStoryProjectId: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getDisplaySettings: vi.fn(),
	getStoryQueryData: vi.fn(),
	backfillMissingQueryDataForSandbox: vi.fn(),
}));

vi.mock('../src/utils/embed-token', () => ({
	verifyEmbedToken: mocks.verifyEmbedToken,
	assertProjectMcpEnabled: mocks.assertProjectMcpEnabled,
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryProjectId: mocks.getStoryProjectId,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getStoryOwnerId: mocks.getStoryOwnerId,
}));
vi.mock('../src/queries/project.queries', () => ({
	getDisplaySettings: mocks.getDisplaySettings,
}));
vi.mock('../src/services/live-story', () => ({
	getStoryQueryData: mocks.getStoryQueryData,
}));
vi.mock('../src/utils/story-query-data', () => ({
	backfillMissingQueryDataForSandbox: mocks.backfillMissingQueryDataForSandbox,
}));

import { loadEmbedStoryContent } from '../src/utils/embed-story';

describe('embedded Story query data', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.verifyEmbedToken.mockReturnValue({
			type: 'story',
			resourceId: 'story-1',
			projectId: 'project-1',
		});
		mocks.getStoryProjectId.mockResolvedValue('project-1');
		mocks.getDisplaySettings.mockResolvedValue({ dateFormat: null });
	});

	it('keeps static embeds on persisted query data', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: false,
		});
		mocks.backfillMissingQueryDataForSandbox.mockResolvedValue({
			query_orders: { columns: ['id'], data: [{ id: 1 }] },
		});

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		expect(mocks.getStoryOwnerId).not.toHaveBeenCalled();
		expect(mocks.getStoryQueryData).not.toHaveBeenCalled();
	});

	it('executes live embeds as the Story owner', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: true,
			cacheSchedule: '0 * * * *',
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: new Date(),
			code: '<table query_id="query_orders" />',
		});

		await loadEmbedStoryContent('story-1', 'token');

		expect(mocks.getStoryQueryData).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'<table query_id="query_orders" />',
			true,
			'0 * * * *',
			'owner-1',
		);
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});

	it('returns refreshed dynamic code with its query data', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '# Old summary\n<table query_id="query_orders" />',
			isLive: true,
			isLiveTextDynamic: true,
			cacheSchedule: null,
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 2 }] } },
			cachedAt: new Date(),
			code: '# Refreshed summary\n<table query_id="query_orders" />',
		});

		await expect(loadEmbedStoryContent('story-1', 'token')).resolves.toMatchObject({
			code: '# Refreshed summary\n<table query_id="query_orders" />',
			queryData: { query_orders: { columns: ['id'], data: [{ id: 2 }] } },
		});
		expect(mocks.getLatestVersionByStoryId).toHaveBeenCalledOnce();
	});

	it('fails closed for live embeds without an authorized owner', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: true,
			cacheSchedule: null,
		});
		mocks.getStoryOwnerId.mockResolvedValue(undefined);

		await expect(loadEmbedStoryContent('story-1', 'token')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});
		expect(mocks.getStoryQueryData).not.toHaveBeenCalled();
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});

	it('does not fall back when live owner access validation fails', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			isLive: true,
			cacheSchedule: null,
		});
		mocks.getStoryOwnerId.mockResolvedValue('removed-owner');
		mocks.getStoryQueryData.mockRejectedValue(new Error('You do not have access to this project.'));

		await expect(loadEmbedStoryContent('story-1', 'token')).rejects.toThrow('access to this project');
		expect(mocks.backfillMissingQueryDataForSandbox).not.toHaveBeenCalled();
	});
});
