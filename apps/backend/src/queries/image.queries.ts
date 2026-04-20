import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import s, { NewMessageImage } from '../db/abstractSchema';
import { db } from '../db/db';

export interface ChatImage {
	id: string;
	data: string;
	mediaType: string;
}

export const getImagesByChatId = async (chatId: string): Promise<ChatImage[]> => {
	return db
		.select({
			id: s.messageImage.id,
			data: s.messageImage.data,
			mediaType: s.messageImage.mediaType,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.messageImage, eq(s.messagePart.imageId, s.messageImage.id))
		.where(
			and(eq(s.chatMessage.chatId, chatId), isNotNull(s.messagePart.imageId), isNull(s.chatMessage.supersededAt)),
		)
		.execute();
};

export const saveImage = async (image: NewMessageImage): Promise<{ id: string }> => {
	const [row] = await db.insert(s.messageImage).values(image).returning({ id: s.messageImage.id }).execute();
	return row;
};

export const saveImages = async (
	images: { mediaType: string; data: string }[],
): Promise<{ id: string; mediaType: string }[]> => {
	if (images.length === 0) {
		return [];
	}

	return db
		.insert(s.messageImage)
		.values(images)
		.returning({ id: s.messageImage.id, mediaType: s.messageImage.mediaType })
		.execute();
};

export const getImageById = async (id: string): Promise<{ data: string; mediaType: string } | undefined> => {
	const [row] = await db
		.select({ data: s.messageImage.data, mediaType: s.messageImage.mediaType })
		.from(s.messageImage)
		.where(eq(s.messageImage.id, id))
		.execute();
	return row;
};
