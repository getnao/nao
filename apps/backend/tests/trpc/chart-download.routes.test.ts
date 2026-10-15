import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	getChartOwnerInfo: vi.fn(),
	getDisplayConfigByToolCallId: vi.fn(),
	getExecuteSqlPartByQueryIdInChat: vi.fn(),
	canUserViewChatContent: vi.fn(),
	generateChartImage: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({
		id: 'attacker-project',
		orgId: 'attacker-org',
		name: 'Mine',
		path: null,
	})),
	getUserRoleInProject: vi.fn(async () => 'admin'),
	getDisplaySettings: vi.fn(async () => ({ dateFormat: 'YYYY-MM-DD' })),
}));
vi.mock('../../src/queries/chart-image', () => ({
	getChartOwnerInfo: mocks.getChartOwnerInfo,
	getDisplayConfigByToolCallId: mocks.getDisplayConfigByToolCallId,
	updateChartConfig: vi.fn(),
}));
vi.mock('../../src/queries/execute-sql.queries', () => ({
	getExecuteSqlPartByQueryIdInChat: mocks.getExecuteSqlPartByQueryIdInChat,
}));
vi.mock('../../src/utils/chat-access', () => ({ canUserViewChatContent: mocks.canUserViewChatContent }));
vi.mock('../../src/components/generate-chart', () => ({ generateChartImage: mocks.generateChartImage }));
vi.mock('../../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));

import { chartRoutes } from '../../src/trpc/chart.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router(chartRoutes);
const CALLER_ID = 'attacker-id';
const caller = createTestCaller(testRouter, { userId: CALLER_ID, selectedProjectId: 'attacker-project' });
const CHART_CONFIG = {
	chart_type: 'bar',
	query_id: 'query-1',
	x_axis_key: 'month',
	series: [{ data_key: 'revenue' }],
	title: 'Revenue',
};

describe('chart.download', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getChartOwnerInfo.mockResolvedValue({
			projectId: 'victim-project',
			userId: 'victim',
			chatId: 'victim-chat',
		});
		mocks.getDisplayConfigByToolCallId.mockResolvedValue(CHART_CONFIG);
		mocks.getExecuteSqlPartByQueryIdInChat.mockResolvedValue({
			toolOutput: { data: [{ month: 'Jan', revenue: 1 }] },
		});
		mocks.generateChartImage.mockReturnValue(Buffer.from('png'));
	});

	it("refuses a chart from a chat the caller can't open", async () => {
		mocks.canUserViewChatContent.mockResolvedValue(false);

		await expect(caller.download({ toolCallId: 'victim-tool-call' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.canUserViewChatContent).toHaveBeenCalledWith('victim-chat', 'victim-project', CALLER_ID);
		expect(mocks.getExecuteSqlPartByQueryIdInChat).not.toHaveBeenCalled();
		expect(mocks.generateChartImage).not.toHaveBeenCalled();
	});

	it("refuses a chart whose query isn't in the chart's own chat", async () => {
		mocks.canUserViewChatContent.mockResolvedValue(true);
		mocks.getExecuteSqlPartByQueryIdInChat.mockResolvedValue(null);

		await expect(caller.download({ toolCallId: 'own-tool-call' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('victim-chat', 'query-1');
		expect(mocks.generateChartImage).not.toHaveBeenCalled();
	});

	it('renders a chart the caller can view from its own chat data', async () => {
		mocks.canUserViewChatContent.mockResolvedValue(true);

		await expect(caller.download({ toolCallId: 'own-tool-call' })).resolves.toBe(
			Buffer.from('png').toString('base64'),
		);
		expect(mocks.generateChartImage).toHaveBeenCalledWith(
			expect.objectContaining({ data: [{ month: 'Jan', revenue: 1 }] }),
		);
	});
});
