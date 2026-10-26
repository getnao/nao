import { and, eq, isNull, sql } from 'drizzle-orm';

import s, { type DBStory } from '../db/abstractSchema';
import { db } from '../db/db';

export interface StoryLinkPreviewRow {
	id: string;
	title: string;
	format: DBStory['format'];
	projectId: string | null;
	ownerName: string | null;
}

export interface ChatLinkPreviewRow {
	title: string;
	projectId: string;
	ownerName: string;
}

export async function getStoryLinkPreview(storyId: string): Promise<StoryLinkPreviewRow | null> {
	const [row] = await db
		.select({
			id: s.story.id,
			title: s.story.title,
			format: s.story.format,
			projectId: sql<string | null>`coalesce(${s.chat.projectId}, ${s.story.projectId})`,
			ownerName: s.user.name,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.leftJoin(s.user, eq(s.user.id, sql`coalesce(${s.chat.userId}, ${s.story.userId})`))
		.where(and(eq(s.story.id, storyId), isNull(s.story.archivedAt)))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function getChatLinkPreview(chatId: string): Promise<ChatLinkPreviewRow | null> {
	const [row] = await db
		.select({ title: s.chat.title, projectId: s.chat.projectId, ownerName: s.user.name })
		.from(s.chat)
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.where(and(eq(s.chat.id, chatId), isNull(s.chat.deletedAt)))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function getSharedStoryStoryId(shareId: string): Promise<string | null> {
	const [row] = await db
		.select({ storyId: s.sharedStory.storyId })
		.from(s.sharedStory)
		.where(eq(s.sharedStory.id, shareId))
		.limit(1)
		.execute();
	return row?.storyId ?? null;
}

export async function getSharedChatChatId(shareId: string): Promise<string | null> {
	const [row] = await db
		.select({ chatId: s.sharedChat.chatId })
		.from(s.sharedChat)
		.where(eq(s.sharedChat.id, shareId))
		.limit(1)
		.execute();
	return row?.chatId ?? null;
}
