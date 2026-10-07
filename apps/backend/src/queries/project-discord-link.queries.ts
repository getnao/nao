import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

/**
 * Discord never exposes a member's email, so a `login <code>` link is the only durable way to
 * attribute a message to a nao user -- and it cannot be derived again after a restart. Every
 * settings change recreates the bot, so the association is persisted rather than cached.
 */
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
