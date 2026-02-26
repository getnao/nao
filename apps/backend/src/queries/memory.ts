import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';

import s, { DBMemory, DBNewMemory } from '../db/abstractSchema';
import { db } from '../db/db';
import { conflictUpdateSet, takeFirstOrThrow } from '../utils/queries';

export const getUserMemories = async (userId: string, excludeChatId?: string): Promise<DBMemory[]> => {
	const memories = await db
		.select({
			id: s.memories.id,
			userId: s.memories.userId,
			chatId: s.memories.chatId,
			content: s.memories.content,
			category: s.memories.category,
			supersededBy: s.memories.supersededBy,
			createdAt: s.memories.createdAt,
			updatedAt: s.memories.updatedAt,
		})
		.from(s.memories)
		.where(
			and(
				eq(s.memories.userId, userId),
				isNull(s.memories.supersededBy),
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

export const upsertAndSupersedeMemories = async (
	memories: (DBNewMemory & { supersedesId?: string | null })[],
): Promise<void> => {
	await db.transaction(async (t) => {
		const promises = memories.map(async (m) => {
			const { id: newMemoryId } = await takeFirstOrThrow(
				t
					.insert(s.memories)
					.values(m)
					.onConflictDoUpdate({
						target: s.memories.id,
						set: conflictUpdateSet(s.memories, ['content', 'category']),
					})
					.returning({ id: s.memories.id })
					.execute(),
			);

			if (m.supersedesId) {
				await t
					.update(s.memories)
					.set({ supersededBy: newMemoryId })
					.where(eq(s.memories.id, m.supersedesId))
					.execute();
			}
		});

		await Promise.all(promises);
	});
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

export const deleteUserMemory = async (userId: string, memoryId: string): Promise<DBMemory | null> => {
	const [deleted] = await db
		.delete(s.memories)
		.where(and(eq(s.memories.id, memoryId), eq(s.memories.userId, userId)))
		.returning()
		.execute();
	return deleted ?? null;
};
