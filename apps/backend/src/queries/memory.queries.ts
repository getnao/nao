import { and, eq, inArray, ne } from 'drizzle-orm';

import s, { DBMemory, NewMemory } from '../db/abstractSchema';
import { db } from '../db/db';

export const getUserMemories = async (userId: string, excludeChatId?: string): Promise<DBMemory[]> => {
	const rows = await db
		.select({ memory: s.memories })
		.from(s.memories)
		.innerJoin(s.chat, eq(s.chat.id, s.memories.chatId))
		.where(and(eq(s.chat.userId, userId), excludeChatId ? ne(s.memories.chatId, excludeChatId) : undefined))
		.execute();

	return rows.map((r) => r.memory);
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
