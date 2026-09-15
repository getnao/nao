import type { StoryTheme } from '@nao/shared/story-theme';
import { parseStoredStoryTheme } from '@nao/shared/story-theme';
import { eq } from 'drizzle-orm';

import s, { DBProjectStoryTheme, NewProjectStoryTheme } from '../db/abstractSchema';
import { db } from '../db/db';

export interface StoryThemeState {
	theme: StoryTheme | null;
	enabled: boolean;
	updatedAt: Date | null;
}

const EMPTY_STATE: StoryThemeState = { theme: null, enabled: false, updatedAt: null };

export async function getStoryThemeState(projectId: string): Promise<StoryThemeState> {
	const row = await getRow(projectId);
	if (!row) {
		return EMPTY_STATE;
	}
	return {
		theme: parseStoredStoryTheme(row.theme),
		enabled: row.enabled,
		updatedAt: row.updatedAt,
	};
}

export async function getActiveStoryTheme(projectId: string): Promise<StoryTheme | null> {
	const state = await getStoryThemeState(projectId);
	return state.enabled ? state.theme : null;
}

export async function saveStoryTheme(projectId: string, theme: StoryTheme): Promise<void> {
	await upsert(projectId, { theme, enabled: true });
}

export async function setStoryThemeEnabled(projectId: string, enabled: boolean): Promise<void> {
	await upsert(projectId, { enabled });
}

export async function resetStoryTheme(projectId: string): Promise<void> {
	await db.delete(s.projectStoryTheme).where(eq(s.projectStoryTheme.projectId, projectId)).execute();
}

async function getRow(projectId: string): Promise<DBProjectStoryTheme | null> {
	const [row] = await db
		.select()
		.from(s.projectStoryTheme)
		.where(eq(s.projectStoryTheme.projectId, projectId))
		.execute();
	return row ?? null;
}

async function upsert(projectId: string, values: Omit<NewProjectStoryTheme, 'projectId'>): Promise<void> {
	await db
		.insert(s.projectStoryTheme)
		.values({ projectId, ...values })
		.onConflictDoUpdate({
			target: s.projectStoryTheme.projectId,
			set: { ...values, updatedAt: new Date() },
		})
		.execute();
}
