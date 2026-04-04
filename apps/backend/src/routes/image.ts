import { z } from 'zod/v4';

import type { App } from '../app';
import { getImageById } from '../queries/image.queries';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	imageId: z.string().uuid(),
});

export const imageRoutes = async (app: App) => {
	app.get('/:imageId', { schema: { params: paramsSchema } }, async (request, reply) => {
		const { imageId } = request.params;

		const image = await getImageById(imageId);
		if (!image) {
			throw new HandlerError('NOT_FOUND', 'Image not found');
		}

		if (!image.mediaType.startsWith('image/')) {
			throw new HandlerError('BAD_REQUEST', 'Invalid media type');
		}

		const buffer = Buffer.from(image.data, 'base64');
		return reply
			.header('Content-Type', image.mediaType)
			.header('Cache-Control', 'public, max-age=31536000, immutable')
			.send(buffer);
	});
};
