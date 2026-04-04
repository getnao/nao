import { and, desc, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getLinkedWhatsappUser = async (
	projectId: string,
	whatsappUserId: string,
): Promise<{ userId: string } | null> => {
	const [link] = await db
		.select({ userId: s.projectWhatsappLink.userId })
		.from(s.projectWhatsappLink)
		.where(
			and(
				eq(s.projectWhatsappLink.projectId, projectId),
				eq(s.projectWhatsappLink.whatsappUserId, whatsappUserId),
			),
		)
		.execute();

	return link ?? null;
};

export const listLinkedWhatsappUsersByUserId = async (
	projectId: string,
	userId: string,
): Promise<
	{
		whatsappUserId: string;
		createdAt: Date;
		updatedAt: Date;
	}[]
> => {
	return db
		.select({
			whatsappUserId: s.projectWhatsappLink.whatsappUserId,
			createdAt: s.projectWhatsappLink.createdAt,
			updatedAt: s.projectWhatsappLink.updatedAt,
		})
		.from(s.projectWhatsappLink)
		.where(and(eq(s.projectWhatsappLink.projectId, projectId), eq(s.projectWhatsappLink.userId, userId)))
		.orderBy(desc(s.projectWhatsappLink.updatedAt))
		.execute();
};

export const upsertLinkedWhatsappUser = async (data: {
	projectId: string;
	whatsappUserId: string;
	userId: string;
}): Promise<void> => {
	await db
		.insert(s.projectWhatsappLink)
		.values(data)
		.onConflictDoUpdate({
			target: [s.projectWhatsappLink.projectId, s.projectWhatsappLink.whatsappUserId],
			set: {
				userId: data.userId,
				updatedAt: new Date(),
			},
		})
		.execute();
};

export const deleteLinkedWhatsappUser = async (projectId: string, whatsappUserId: string): Promise<void> => {
	await db
		.delete(s.projectWhatsappLink)
		.where(
			and(
				eq(s.projectWhatsappLink.projectId, projectId),
				eq(s.projectWhatsappLink.whatsappUserId, whatsappUserId),
			),
		)
		.execute();
};

export const deleteLinkedWhatsappUserByUserId = async (
	projectId: string,
	userId: string,
	whatsappUserId: string,
): Promise<void> => {
	await db
		.delete(s.projectWhatsappLink)
		.where(
			and(
				eq(s.projectWhatsappLink.projectId, projectId),
				eq(s.projectWhatsappLink.userId, userId),
				eq(s.projectWhatsappLink.whatsappUserId, whatsappUserId),
			),
		)
		.execute();
};
