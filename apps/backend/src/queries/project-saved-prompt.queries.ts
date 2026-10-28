import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { and, desc, eq } from 'drizzle-orm';

import s, { DBProjectSavedPrompt, NewProjectSavedPrompt } from '../db/abstractSchema';
import { db } from '../db/db';
import { SavedPrompt } from '../types/saved-prompt';

const SYSTEM_EXAMPLE_SAVED_PROMPTS: NewProjectSavedPrompt[] = [
	{
		id: 'system-example-monthly-revenue',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'How is monthly revenue trending?',
		prompt: 'How is monthly revenue trending?',
	},
	{
		id: 'system-example-top-customers',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'Make a chart of our top 5 customers by total revenue.',
		prompt: 'Make a chart of our top 5 customers by total revenue.',
	},
	{
		id: 'system-example-sales-performance-story',
		projectId: SYSTEM_EXAMPLE_PROJECT_ID,
		title: 'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
		prompt: 'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
	},
];

export const listSavedPrompts = async (projectId: string): Promise<SavedPrompt[]> => {
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

export const upsertSystemExampleSavedPrompts = async (): Promise<void> => {
	for (const savedPrompt of SYSTEM_EXAMPLE_SAVED_PROMPTS) {
		await db
			.insert(s.projectSavedPrompt)
			.values(savedPrompt)
			.onConflictDoUpdate({
				target: s.projectSavedPrompt.id,
				set: { title: savedPrompt.title, prompt: savedPrompt.prompt },
			})
			.execute();
	}
};

export const createSavedPrompt = async (data: NewProjectSavedPrompt): Promise<DBProjectSavedPrompt> => {
	const [created] = await db.insert(s.projectSavedPrompt).values(data).returning().execute();
	return created;
};

export const updateSavedPrompt = async (
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

export const deleteSavedPrompt = async (projectId: string, promptId: string): Promise<void> => {
	await db
		.delete(s.projectSavedPrompt)
		.where(and(eq(s.projectSavedPrompt.id, promptId), eq(s.projectSavedPrompt.projectId, projectId)))
		.execute();
};
