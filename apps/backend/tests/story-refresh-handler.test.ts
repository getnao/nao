import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryById: vi.fn(),
	getStoryProjectId: vi.fn(),
	getStoryOwnerId: vi.fn(),
	startStoryRefreshActivity: vi.fn(),
	completeActivity: vi.fn(),
	failActivity: vi.fn(),
	refreshStoryData: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
	getStoryProjectId: mocks.getStoryProjectId,
	getStoryOwnerId: mocks.getStoryOwnerId,
}));
vi.mock('../src/queries/activity.queries', () => ({
	startStoryRefreshActivity: mocks.startStoryRefreshActivity,
	completeActivity: mocks.completeActivity,
	failActivity: mocks.failActivity,
}));
vi.mock('../src/services/live-story', () => ({
	refreshStoryData: mocks.refreshStoryData,
}));
vi.mock('../src/utils/analytics-event', () => ({
	logAnalyticsEvent: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

import { runScheduledStoryRefresh } from '../src/handlers/story-refresh.handler';

describe('scheduled Story refresh principal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStoryById.mockResolvedValue({
			id: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
			isLive: true,
			archivedAt: null,
			projectId: 'project-1',
			userId: 'owner-1',
		});
		mocks.startStoryRefreshActivity.mockResolvedValue({ id: 'activity-1' });
		mocks.refreshStoryData.mockResolvedValue({ queryData: {} });
	});

	it('executes warehouse queries as the Story owner', async () => {
		await runScheduledStoryRefresh('story-1');

		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders', 'owner-1');
	});

	it('fails the scheduled refresh when the owner has lost project access', async () => {
		mocks.refreshStoryData.mockRejectedValue(new Error('You do not have access to this project.'));

		await expect(runScheduledStoryRefresh('story-1')).rejects.toThrow('access to this project');
		expect(mocks.failActivity).toHaveBeenCalledWith('activity-1', 'You do not have access to this project.');
		expect(mocks.completeActivity).not.toHaveBeenCalled();
	});
});
