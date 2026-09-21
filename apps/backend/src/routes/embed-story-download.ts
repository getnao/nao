import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { z } from 'zod/v4';

import type { App } from '../app';
import { loadEmbedStoryContent } from '../utils/embed-story';
import { buildStoryDownloadFile } from '../utils/story-download';

export const embedStoryDownloadRoutes = async (app: App) => {
	app.get(
		'/story/:storyId/download',
		{
			schema: {
				params: z.object({ storyId: z.string() }),
				querystring: z.object({
					token: z.string(),
					format: z.enum(DOWNLOAD_FORMATS),
				}),
			},
		},
		async (request, reply) => {
			const { storyId } = request.params;
			const { token, format: formatRaw } = request.query;

			const story = await loadEmbedStoryContent(storyId, token);
			const { buffer, filename, mimeType } = await buildStoryDownloadFile(
				formatRaw,
				story.title,
				story.code,
				story.queryData,
				story.dateFormat,
			);

			const safeName = filename.replace(/[^\x20-\x7E]+/g, '_');
			return reply
				.header('Content-Type', mimeType)
				.header('Content-Disposition', `attachment; filename="${safeName}"`)
				.send(buffer);
		},
	);
};
