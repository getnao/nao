import { z } from 'zod/v4';

import type { App } from '../app';
import { getChartById } from '../queries/chart-image';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	chartid: z.string(),
});

export const chartRoutes = async (app: App) => {
	app.get('/:chatId/:chartid.png', { schema: { params: paramsSchema } }, async (request, reply) => {
		const { chartid } = request.params;

		const imageData = await getChartById(chartid);
		if (!imageData) {
			throw new HandlerError('NOT_FOUND', 'Chart image not found');
		}

		const buffer = Buffer.from(imageData, 'base64');
		return reply.header('Content-Type', 'image/png').send(buffer);
	});
};
