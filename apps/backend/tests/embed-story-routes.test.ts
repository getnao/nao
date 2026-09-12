import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadEmbedStoryContent: vi.fn(),
	buildDownloadResponse: vi.fn(),
}));

vi.mock('../src/utils/embed-story', () => ({
	loadEmbedStoryContent: mocks.loadEmbedStoryContent,
	embedStoryOpenPath: vi.fn(() => '/stories/preview/chat-1/orders'),
}));
vi.mock('../src/utils/story-download', () => ({
	buildDownloadResponse: mocks.buildDownloadResponse,
}));
vi.mock('../src/utils/analytics-event', () => ({
	logAnalyticsEvent: vi.fn(),
}));

import { embedRoutes } from '../src/trpc/embed.routes';

describe('public embedded Story routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadEmbedStoryContent.mockResolvedValue({
			storyId: 'story-1',
			projectId: 'project-1',
			title: 'Orders',
			code: '<table query_id="query_orders" />',
			slug: 'orders',
			chatId: 'chat-1',
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			dateFormat: null,
		});
		mocks.buildDownloadResponse.mockReturnValue({ filename: 'orders.pdf' });
	});

	it('loads the public embed view through the guarded utility', async () => {
		const caller = embedRoutes.createCaller({} as never);

		await expect(caller.getStory({ storyId: 'story-1', token: 'token' })).resolves.toMatchObject({
			id: 'story-1',
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		expect(mocks.loadEmbedStoryContent).toHaveBeenCalledWith('story-1', 'token');
	});

	it('loads public downloads through the guarded utility', async () => {
		const caller = embedRoutes.createCaller({} as never);

		await expect(caller.downloadStory({ storyId: 'story-1', token: 'token', format: 'pdf' })).resolves.toEqual({
			filename: 'orders.pdf',
		});
		expect(mocks.loadEmbedStoryContent).toHaveBeenCalledWith('story-1', 'token');
		expect(mocks.buildDownloadResponse).toHaveBeenCalledWith(
			'pdf',
			'Orders',
			'<table query_id="query_orders" />',
			{ query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			null,
		);
	});
});
