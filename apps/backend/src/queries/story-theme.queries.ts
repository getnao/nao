import type { StoryThemePair } from '@nao/shared/story-theme';
import { sameThemePair } from '@nao/shared/story-theme';
import { parseStoredStoryThemePair } from '@nao/shared/story-theme-pair';
import { asc, desc, eq, sql } from 'drizzle-orm';

import s, { DBProjectStoryTheme } from '../db/abstractSchema';
import { db } from '../db/db';

export interface StoryThemeState {
	theme: StoryThemePair | null;
	enabled: boolean;
	createdAt: Date | null;
}

export interface StoryThemeVersion {
	version: number;
	theme: StoryThemePair;
	createdAt: Date;
}

const EMPTY_STATE: StoryThemeState = { theme: null, enabled: false, createdAt: null };

export async function getStoryThemeState(projectId: string): Promise<StoryThemeState> {
	const row = await getLatest(projectId);
	if (!row) {
		return EMPTY_STATE;
	}
	return {
		theme: parseStoredStoryThemePair(row.theme),
		enabled: row.enabled,
		createdAt: row.createdAt,
	};
}

export async function getActiveStoryTheme(projectId: string): Promise<StoryThemePair | null> {
	const state = await getStoryThemeState(projectId);
	return state.enabled ? state.theme : null;
}

export async function listStoryThemeVersions(projectId: string): Promise<StoryThemeVersion[]> {
	const rows = await db
		.select()
		.from(s.projectStoryTheme)
		.where(eq(s.projectStoryTheme.projectId, projectId))
		.orderBy(asc(s.projectStoryTheme.version))
		.execute();
	return rows.flatMap((row) => {
		const theme = parseStoredStoryThemePair(row.theme);
		if (!theme) {
			return [];
		}
		return [{ version: row.version, theme, createdAt: row.createdAt }];
	});
}

export async function saveStoryTheme(projectId: string, theme: StoryThemePair): Promise<void> {
	const latest = await getLatest(projectId);
	const latestTheme = latest ? parseStoredStoryThemePair(latest.theme) : null;
	if (latestTheme && sameThemePair(latestTheme, theme)) {
		if (latest && !latest.enabled) {
			await setStoryThemeEnabled(projectId, true);
		}
		return;
	}

	const nextVersion = db
		.select({ v: sql<number>`coalesce(max(${s.projectStoryTheme.version}), 0) + 1` })
		.from(s.projectStoryTheme)
		.where(eq(s.projectStoryTheme.projectId, projectId));

	await db
		.insert(s.projectStoryTheme)
		.values({
			projectId,
			theme,
			enabled: true,
			version: sql`(${nextVersion})`,
		})
		.execute();
}

export async function restoreStoryThemeVersion(projectId: string, version: number): Promise<StoryThemePair | null> {
	const versions = await listStoryThemeVersions(projectId);
	const match = versions.find((entry) => entry.version === version);
	if (!match) {
		return null;
	}
	await saveStoryTheme(projectId, match.theme);
	return match.theme;
}

export async function setStoryThemeEnabled(projectId: string, enabled: boolean): Promise<void> {
	const latest = await getLatest(projectId);
	if (!latest) {
		return;
	}
	await db.update(s.projectStoryTheme).set({ enabled }).where(eq(s.projectStoryTheme.id, latest.id)).execute();
}

async function getLatest(projectId: string): Promise<DBProjectStoryTheme | null> {
	const [row] = await db
		.select()
		.from(s.projectStoryTheme)
		.where(eq(s.projectStoryTheme.projectId, projectId))
		.orderBy(desc(s.projectStoryTheme.version))
		.limit(1)
		.execute();
	return row ?? null;
}
