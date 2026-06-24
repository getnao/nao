import { ANALYTICS_ASSET_TYPES } from '@nao/shared/types';
import { z } from 'zod';

import type { App } from '../app';
import { getAuth } from '../auth';
import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { convertHeaders } from '../utils/utils';

const MAX_DURATION_MS = 4 * 60 * 60 * 1_000; // 4 hours

const viewDurationBodySchema = z.object({
	assetType: z.enum(ANALYTICS_ASSET_TYPES),
	chatId: z.string().optional(),
	storyId: z.string().optional(),
	storySlug: z.string().optional(),
	versionNumber: z.number().int().positive().optional(),
	durationMs: z.number(),
	startedAt: z.number(),
});

export const analyticsRoutes = async (app: App) => {
	app.post('/view-duration', async (request, reply) => {
		const auth = await getAuth();
		if (!auth) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}

		const parsed = viewDurationBodySchema.safeParse(request.body);
		if (!parsed.success) {
			return reply.status(400).send({ error: 'Invalid request body' });
		}

		const { assetType, chatId, storyId, storySlug, versionNumber, durationMs, startedAt } = parsed.data;

		if (durationMs <= 0 || durationMs > MAX_DURATION_MS) {
			return reply.status(204).send();
		}

		const userId = session.user.id;
		let projectId: string | null | undefined;
		let resolvedStoryId: string | null = null;

		if (assetType === 'chat' && typeof chatId === 'string') {
			projectId = await chatQueries.getChatProjectId(chatId);
		} else if (assetType === 'story') {
			if (typeof storyId === 'string') {
				resolvedStoryId = storyId;
				projectId = await storyQueries.getStoryProjectId(storyId);
			} else if (typeof chatId === 'string' && typeof storySlug === 'string') {
				const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
				if (story) {
					resolvedStoryId = story.id;
					projectId = await storyQueries.getStoryProjectId(story.id);
				}
			}
		}

		if (!projectId) {
			return reply.status(404).send({ error: 'Asset not found' });
		}

		const canAccess =
			assetType === 'chat'
				? typeof chatId === 'string' && (await chatQueries.canUserAccessChat(chatId, userId))
				: resolvedStoryId !== null && (await storyQueries.canUserAccessStory(resolvedStoryId, userId));

		if (!canAccess) {
			return reply.status(403).send({ error: 'Forbidden' });
		}

		logAnalyticsEvent({
			projectId,
			type: 'view_duration',
			assetType,
			actorUserId: userId,
			chatId: typeof chatId === 'string' ? chatId : null,
			storyId: resolvedStoryId,
			metadata: { type: 'view_duration', durationMs, startedAt, versionNumber },
		});

		return reply.status(204).send();
	});
};
