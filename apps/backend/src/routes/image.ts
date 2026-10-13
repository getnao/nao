import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import { getImageById, listChatsReferencingImage } from '../queries/image.queries';
import { canUserViewChatContent } from '../utils/chat-access';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	imageId: z.string().uuid(),
});

export const imageRoutes = async (app: App) => {
	app.get('/:imageId', { preHandler: authMiddleware, schema: { params: paramsSchema } }, async (request, reply) => {
		const { imageId } = request.params;

		if (!(await canUserViewImage(imageId, request.user.id))) {
			throw new HandlerError('NOT_FOUND', 'Image not found');
		}

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
			.header('Cache-Control', 'private, max-age=31536000, immutable')
			.send(buffer);
	});
};

async function canUserViewImage(imageId: string, userId: string): Promise<boolean> {
	const chats = await listChatsReferencingImage(imageId);
	for (const { chatId, projectId } of chats) {
		if (await canUserViewChatContent(chatId, projectId, userId)) {
			return true;
		}
	}
	return false;
}
