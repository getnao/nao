import type { App } from '../app';
import * as chatQueries from '../queries/chat.queries';
import { HandlerError } from '../utils/error';

export const chartRoutes = async (app: App) => {
	app.get('/:toolCallId', async (request, reply) => {
		const { toolCallId } = request.params as { toolCallId: string };

		const imageData = await chatQueries.getChart(toolCallId);
		if (!imageData) {
			throw new HandlerError('NOT_FOUND', 'Chart image not found');
		}

		const buffer = Buffer.from(imageData, 'base64');
		return reply.header('Content-Type', 'image/png').send(buffer);
	});
};
