import type { DBScheduledJob } from '../db/abstractSchema';
import * as activityQueries from '../queries/activity.queries';
import * as storyQueries from '../queries/story.queries';
import { refreshStoryData } from '../services/live-story';
import { logger } from '../utils/logger';

export const STORY_REFRESH_JOB_NAME = 'story.refresh';

type StoryRefreshJobPayload = {
	storyId?: string;
};

export async function storyRefreshHandler(payload: StoryRefreshJobPayload, _job?: DBScheduledJob): Promise<void> {
	const storyId = payload.storyId;
	if (!storyId) {
		throw new Error('storyId is required.');
	}
	await runScheduledStoryRefresh(storyId);
}

/**
 * Runs a scheduled refresh for a live story and records the outcome as an
 * `activity` row so it surfaces in the activity feed.
 */
export async function runScheduledStoryRefresh(storyId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		throw new Error(`Story not found: ${storyId}`);
	}
	if (!story.chatId) {
		throw new Error(`Story has no chat to refresh: ${storyId}`);
	}
	if (!story.isLive || story.archivedAt) {
		return;
	}

	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	const userId = story.userId ?? (await storyQueries.getStoryOwnerId(story.id));
	if (!projectId || !userId) {
		throw new Error(`Story ${storyId} is missing project or user ownership; cannot schedule refresh.`);
	}

	const activity = await activityQueries.startStoryRefreshActivity({
		projectId,
		userId,
		storyId,
		chatId: story.chatId,
		trigger: 'schedule',
	});

	try {
		const { queryData } = await refreshStoryData(story.chatId, story.slug);
		await activityQueries.completeActivity(activity.id, { queriesRefreshed: Object.keys(queryData).length });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Story refresh failed: ${message}`, {
			source: 'system',
			projectId,
			context: { storyId, activityId: activity.id },
		});
		await activityQueries.failActivity(activity.id, message);
		throw err;
	}
}
