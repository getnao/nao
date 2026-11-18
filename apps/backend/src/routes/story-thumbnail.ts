import { createHash } from 'node:crypto';

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
	mode: z.enum(STORY_THEME_MODES).default('light'),
});

export const storyThumbnailRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.get(
		'/:storyId/thumbnail',
		{ schema: { params: paramsSchema, querystring: querySchema } },
		async (request, reply) => {
			const { storyId } = request.params;
			const { mode } = request.query;
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

			const etag = thumbnailEtag(thumbnail.image);
			reply.header('Cache-Control', 'private, no-cache').header('ETag', etag);
			if (matchesEtag(request.headers['if-none-match'], etag)) {
				return reply.status(304).send();
			}
			return reply.header('Content-Type', 'image/webp').send(thumbnail.image);
		},
	);
};

function thumbnailEtag(image: Buffer): string {
	return `"${createHash('sha256').update(image).digest('base64url')}"`;
}

function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
	if (!ifNoneMatch) {
		return false;
	}
	return ifNoneMatch
		.split(',')
		.map((tag) => tag.trim().replace(/^W\//, ''))
		.some((tag) => tag === '*' || tag === etag);
}
