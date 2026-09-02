import { z } from 'zod/v4';

import type { App } from '../app';
import { getAuth } from '../auth';
import { canUserAccessChat } from '../queries/chat.queries';
import { getChatIdsByImageId, getImageById } from '../queries/image.queries';
import { HandlerError } from '../utils/error';
import { convertHeaders } from '../utils/utils';

const paramsSchema = z.object({
	imageId: z.string().uuid(),
});

export const imageRoutes = async (app: App) => {
	app.get('/:imageId', { schema: { params: paramsSchema } }, async (request, reply) => {
		const { imageId } = request.params;

		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: convertHeaders(request.headers) });
		if (!session?.user) {
			throw new HandlerError('UNAUTHORIZED', 'Unauthorized');
		}

		const image = await getImageById(imageId);
		if (!image) {
			throw new HandlerError('NOT_FOUND', 'Image not found');
		}

		// An image with no owning chat (never attached, or its message was removed) is reported as
		// not found rather than served: there is no one to check access against.
		const chatIds = await getChatIdsByImageId(imageId);
		if (chatIds.length === 0) {
			throw new HandlerError('NOT_FOUND', 'Image not found');
		}

		// A fork re-references the same image row, so access is granted through any owning chat.
		const accessible = await Promise.all(chatIds.map((chatId) => canUserAccessChat(chatId, session.user.id)));
		if (!accessible.some(Boolean)) {
			throw new HandlerError('FORBIDDEN', 'Forbidden');
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
