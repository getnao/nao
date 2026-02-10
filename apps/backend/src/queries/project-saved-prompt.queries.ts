import { and, desc, eq } from 'drizzle-orm';

import s, { DBProjectSavedPrompt, NewProjectSavedPrompt } from '../db/abstractSchema';
import { db } from '../db/db';
import { SavedPrompt } from '../types/saved-prompt';

export const getAll = async (projectId: string): Promise<SavedPrompt[]> => {
	return db
		.select({
			id: s.projectSavedPrompt.id,
			title: s.projectSavedPrompt.title,
			prompt: s.projectSavedPrompt.prompt,
			createdAt: s.projectSavedPrompt.createdAt,
			updatedAt: s.projectSavedPrompt.updatedAt,
		})
		.from(s.projectSavedPrompt)
		.where(eq(s.projectSavedPrompt.projectId, projectId))
		.orderBy(desc(s.projectSavedPrompt.createdAt))
		.execute();
};

export const create = async (data: NewProjectSavedPrompt): Promise<DBProjectSavedPrompt> => {
	const [created] = await db.insert(s.projectSavedPrompt).values(data).returning().execute();
	return created;
};

export const update = async (
	projectId: string,
	promptId: string,
	data: Partial<Pick<NewProjectSavedPrompt, 'title' | 'prompt'>>,
): Promise<DBProjectSavedPrompt | null> => {
	const [updated] = await db
		.update(s.projectSavedPrompt)
		.set(data)
		.where(and(eq(s.projectSavedPrompt.id, promptId), eq(s.projectSavedPrompt.projectId, projectId)))
		.returning()
		.execute();
	return updated ?? null;
};

export const remove = async (projectId: string, promptId: string): Promise<void> => {
	await db
		.delete(s.projectSavedPrompt)
		.where(and(eq(s.projectSavedPrompt.id, promptId), eq(s.projectSavedPrompt.projectId, projectId)))
		.execute();
};
