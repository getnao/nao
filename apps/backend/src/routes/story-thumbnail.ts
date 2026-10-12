import { STORY_THEME_MODES } from '@nao/shared/story-theme';
import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as storyQueries from '../queries/story.queries';
import { getCustomStoryThumbnail } from '../services/custom-story-thumbnail';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	storyId: z.string(),
});

const querySchema = z.object({
	version: z.coerce.number().int().optional(),
	theme: z.string().optional(),
	mode: z.enum(STORY_THEME_MODES).default('light'),
});

export const storyThumbnailRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.get(
		'/:storyId/thumbnail',
		{ schema: { params: paramsSchema, querystring: querySchema } },
		async (request, reply) => {
			const { storyId } = request.params;
			const { version, theme, mode } = request.query;
			const story = await storyQueries.getStoryById(storyId);
			if (
				!story ||
				story.format !== 'custom' ||
				!(await storyQueries.canUserAccessStory(storyId, request.user.id))
			) {
				throw new HandlerError('NOT_FOUND', 'Story not found');
			}

			const thumbnail = await getCustomStoryThumbnail(story, mode);
			if (!thumbnail) {
				return reply
					.status(404)
					.header('Cache-Control', 'no-store')
					.send({ error: 'Thumbnail not rendered yet' });
			}

			const etag = `"${thumbnail.versionId}.${thumbnail.theme}.${mode}"`;
			const isVersioned = thumbnail.isCurrent && version === thumbnail.versionNumber && theme === thumbnail.theme;
			reply
				.header('Cache-Control', isVersioned ? 'private, max-age=31536000, immutable' : 'private, no-cache')
				.header('ETag', etag);
			if (request.headers['if-none-match'] === etag) {
				return reply.status(304).send();
			}
			return reply.header('Content-Type', 'image/webp').send(thumbnail.image);
		},
	);
};
