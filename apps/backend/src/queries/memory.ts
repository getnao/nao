import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import s, { DBMemory, DBNewMemory } from '../db/abstractSchema';
import { db } from '../db/db';
import { conflictUpdateSet } from '../utils/queries';

export const getUserMemories = async (userId: string, excludeChatId?: string): Promise<DBMemory[]> => {
	const memories = await db
		.select({
			id: s.memories.id,
			userId: s.memories.userId,
			chatId: s.memories.chatId,
			content: s.memories.content,
			category: s.memories.category,
			createdAt: s.memories.createdAt,
			updatedAt: s.memories.updatedAt,
		})
		.from(s.memories)
		.where(
			and(
				eq(s.memories.userId, userId),
				excludeChatId ? or(ne(s.memories.chatId, excludeChatId), isNull(s.memories.chatId)) : undefined,
			),
		)
		.orderBy(desc(s.memories.createdAt))
		.execute();

	return memories;
};

export const getIsMemoryEnabledForUserAndProject = async (userId: string, projectId: string): Promise<boolean> => {
	const [settings] = await db
		.select({
			userEnabled: s.user.memoryEnabled,
			projectAgentSettings: s.project.agentSettings,
		})
		.from(s.user)
		.innerJoin(s.project, eq(s.project.id, projectId))
		.where(eq(s.user.id, userId))
		.execute();

	if (!settings) {
		return false;
	}

	const projectEnabled = settings.projectAgentSettings?.memoryEnabled ?? true;
	return settings.userEnabled && projectEnabled;
};

export const upsertMemories = async (memories: DBNewMemory[]): Promise<void> => {
	if (memories.length === 0) {
		return;
	}

	await db
		.insert(s.memories)
		.values(memories)
		.onConflictDoUpdate({
			target: s.memories.id,
			set: conflictUpdateSet(s.memories, ['content', 'category']),
		})
		.execute();
};

export const deleteMemories = async (memoryIds: string[]): Promise<void> => {
	if (memoryIds.length === 0) {
		return;
	}

	await db.delete(s.memories).where(inArray(s.memories.id, memoryIds)).execute();
};

export const updateUserMemoryContent = async (
	userId: string,
	memoryId: string,
	content: string,
): Promise<DBMemory | null> => {
	const [updated] = await db
		.update(s.memories)
		.set({ content })
		.where(and(eq(s.memories.id, memoryId), eq(s.memories.userId, userId)))
		.returning()
		.execute();
	return updated ?? null;
};

export const deleteUserMemory = async (userId: string, memoryId: string): Promise<boolean> => {
	const deleted = await db
		.delete(s.memories)
		.where(and(eq(s.memories.id, memoryId), eq(s.memories.userId, userId)))
		.returning({ id: s.memories.id })
		.execute();
	return deleted.length > 0;
};
