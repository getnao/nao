import { eq } from 'drizzle-orm';

import s, { NewMessageImage } from '../db/abstractSchema';
import { db } from '../db/db';

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
