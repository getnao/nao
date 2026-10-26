import { z } from 'zod/v4';

import type { App } from '../app';
import { getLinkPreviewLogo, getLinkPreviewStoryThumbnail } from '../services/link-preview.service';
import { HandlerError } from '../utils/error';
import { toPreviewLogo, toPreviewThumbnail } from '../utils/link-preview-image';

const storyParamsSchema = z.object({
	storyId: z.string(),
});

const CACHE_CONTROL = 'public, max-age=300';

/** Public on purpose: link unfurlers fetch these images without a session. */
export const linkPreviewRoutes = async (app: App) => {
	app.get('/stories/:storyId/thumbnail.jpg', { schema: { params: storyParamsSchema } }, async (request, reply) => {
		const thumbnail = await getLinkPreviewStoryThumbnail(request.params.storyId);
		if (!thumbnail) {
			throw new HandlerError('NOT_FOUND', 'Thumbnail not found');
		}
		return reply
			.header('Content-Type', 'image/jpeg')
			.header('Cache-Control', CACHE_CONTROL)
			.send(await toPreviewThumbnail(thumbnail));
	});

	app.get('/logo.png', async (_request, reply) => {
		const logo = await getLinkPreviewLogo();
		if (!logo) {
			throw new HandlerError('NOT_FOUND', 'Logo not found');
		}
		return reply
			.header('Content-Type', 'image/png')
			.header('Cache-Control', CACHE_CONTROL)
			.send(await toPreviewLogo(logo));
	});
};
