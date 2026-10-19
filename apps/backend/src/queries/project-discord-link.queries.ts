import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getLinkedDiscordUser = async (
	projectId: string,
	discordUserId: string,
): Promise<{ userId: string } | null> => {
	const [link] = await db
		.select({ userId: s.projectDiscordLink.userId })
		.from(s.projectDiscordLink)
		.where(
			and(eq(s.projectDiscordLink.projectId, projectId), eq(s.projectDiscordLink.discordUserId, discordUserId)),
		)
		.execute();

	return link ?? null;
};

export const upsertLinkedDiscordUser = async (data: {
	projectId: string;
	discordUserId: string;
	userId: string;
}): Promise<void> => {
	await db
		.insert(s.projectDiscordLink)
		.values(data)
		.onConflictDoUpdate({
			target: [s.projectDiscordLink.projectId, s.projectDiscordLink.discordUserId],
			set: { userId: data.userId, updatedAt: new Date() },
		})
		.execute();
};

export const deleteLinkedDiscordUsers = async (projectId: string): Promise<void> => {
	await db.delete(s.projectDiscordLink).where(eq(s.projectDiscordLink.projectId, projectId)).execute();
};
