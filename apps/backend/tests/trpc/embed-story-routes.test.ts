import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadEmbedStoryContent: vi.fn(),
	buildDownloadResponse: vi.fn(),
	verifyEmbedToken: vi.fn(),
	getMcpChartEmbedById: vi.fn(),
	getMcpQueryData: vi.fn(),
	getActiveThemeForProject: vi.fn(),
}));

vi.mock('../../src/utils/embed-story', () => ({
	loadEmbedStoryContent: mocks.loadEmbedStoryContent,
}));
vi.mock('../../src/utils/story-download', () => ({
	buildDownloadResponse: mocks.buildDownloadResponse,
}));
vi.mock('../../src/utils/analytics-event', () => ({
	logAnalyticsEvent: vi.fn(),
}));
vi.mock('../../src/utils/embed-token', () => ({
	verifyEmbedToken: mocks.verifyEmbedToken,
	assertProjectMcpEnabled: vi.fn(),
}));
vi.mock('../../src/queries/mcp-embed.queries', () => ({
	getMcpChartEmbedById: mocks.getMcpChartEmbedById,
	getMcpMapEmbedById: vi.fn(),
}));
vi.mock('../../src/queries/mcp-query-data.queries', () => ({
	getMcpQueryData: mocks.getMcpQueryData,
}));
vi.mock('../../src/services/custom-story', () => ({
	getActiveThemeForProject: mocks.getActiveThemeForProject,
}));

import { embedRoutes } from '../../src/trpc/embed.routes';

const caller = embedRoutes.createCaller({} as never);

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
			theme: null,
		});
		mocks.buildDownloadResponse.mockReturnValue({ filename: 'orders.pdf' });
	});

	it('loads the public embed view through the guarded utility', async () => {
		await expect(caller.getStory({ storyId: 'story-1', token: 'token' })).resolves.toMatchObject({
			id: 'story-1',
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		expect(mocks.loadEmbedStoryContent).toHaveBeenCalledWith('story-1', 'token');
	});

	it('loads public downloads through the guarded utility', async () => {
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
			null,
		);
	});
});

describe('public embedded chart route', () => {
	it("returns the project's story theme so the chart matches its stories", async () => {
		const theme = { light: { name: 'brand-light' }, dark: { name: 'brand-dark' } };
		mocks.verifyEmbedToken.mockReturnValue({ type: 'chart', resourceId: 'chart-1', projectId: 'project-1' });
		mocks.getMcpChartEmbedById.mockResolvedValue({
			projectId: 'project-1',
			queryId: 'query-1',
			sourceChatId: null,
			chartConfig: { chartType: 'pie' },
		});
		mocks.getMcpQueryData.mockResolvedValue({ data: [{ status: 'completed' }], sourceChatId: null });
		mocks.getActiveThemeForProject.mockResolvedValue(theme);

		await expect(caller.getChart({ chartEmbedId: 'chart-1', token: 'token' })).resolves.toMatchObject({ theme });
		expect(mocks.getActiveThemeForProject).toHaveBeenCalledWith('project-1');
	});
});
