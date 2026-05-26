import type { ActivityType, DBActivity } from '../db/abstractSchema';
import * as activityQueries from '../queries/activity.queries';
import { logger } from '../utils/logger';

export interface LogActivityInput {
	projectId: string;
	userId: string | null;
	type: ActivityType;
	storyId?: string | null;
	chatId?: string | null;
	sharedStoryId?: string | null;
	sharedChatId?: string | null;
	payload?: Record<string, unknown> | null;
}

/**
 * Records a completed activity row. Used by call sites that just want to log
 * a one-shot event (a share, a pin, …) and surface it in the feed. Failures
 * are swallowed and logged so feed-keeping never blocks the originating
 * action.
 */
export async function logActivity(input: LogActivityInput): Promise<DBActivity | null> {
	try {
		return await activityQueries.createActivity({
			projectId: input.projectId,
			userId: input.userId,
			type: input.type,
			status: 'completed',
			trigger: 'manual',
			storyId: input.storyId ?? null,
			chatId: input.chatId ?? null,
			sharedStoryId: input.sharedStoryId ?? null,
			sharedChatId: input.sharedChatId ?? null,
			payload: input.payload ?? null,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Failed to log activity '${input.type}': ${message}`, {
			source: 'system',
			projectId: input.projectId,
			context: {
				type: input.type,
				storyId: input.storyId,
				chatId: input.chatId,
				sharedStoryId: input.sharedStoryId,
				sharedChatId: input.sharedChatId,
			},
		});
		return null;
	}
}
