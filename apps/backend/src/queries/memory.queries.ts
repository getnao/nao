import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import s, { DBMemory, NewMemory } from '../db/abstractSchema';
import { db } from '../db/db';

export const getUserMemories = async (userId: string, excludeChatId?: string): Promise<DBMemory[]> => {
	const memories = await db
		.select({
			id: s.memories.id,
			content: s.memories.content,
			category: s.memories.category,
			createdAt: s.memories.createdAt,
			chatId: s.memories.chatId,
		})
		.from(s.memories)
		.innerJoin(s.chat, eq(s.chat.id, s.memories.chatId))
		.where(and(eq(s.chat.userId, userId), excludeChatId ? ne(s.memories.chatId, excludeChatId) : undefined))
		.orderBy(desc(s.memories.createdAt))
		.execute();

	return memories;
};

export const upsertMemory = async (memory: NewMemory): Promise<void> => {
	await db
		.insert(s.memories)
		.values(memory)
		.onConflictDoUpdate({ target: s.memories.id, set: { content: memory.content, category: memory.category } })
		.execute();
};

export const deleteMemories = async (memoryIds: string[]): Promise<void> => {
	if (memoryIds.length === 0) {
		return;
	}

	await db.delete(s.memories).where(inArray(s.memories.id, memoryIds)).execute();
};
