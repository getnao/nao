import type { StoryStateScope } from '@nao/shared/story-app';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import s, { type DBStoryAppState } from '../db/abstractSchema';
import { db } from '../db/db';

export interface StoryAppStateKey {
	storyId: string;
	scope: StoryStateScope;
	userId: string | null;
	key: string;
}

export function listUserStoryAppState(storyId: string, userId: string): Promise<DBStoryAppState[]> {
	return db
		.select()
		.from(s.storyAppState)
		.where(
			and(
				eq(s.storyAppState.storyId, storyId),
				eq(s.storyAppState.scope, 'user'),
				eq(s.storyAppState.userId, userId),
			),
		)
		.execute();
}

export function listProjectStoryAppState(storyId: string): Promise<DBStoryAppState[]> {
	return db
		.select()
		.from(s.storyAppState)
		.where(and(eq(s.storyAppState.storyId, storyId), eq(s.storyAppState.scope, 'project')))
		.execute();
}

export async function hasStoryAppStateKey(stateKey: StoryAppStateKey): Promise<boolean> {
	const [row] = await db
		.select({ id: s.storyAppState.id })
		.from(s.storyAppState)
		.where(matchesKey(stateKey))
		.limit(1)
		.execute();
	return row !== undefined;
}

export async function countStoryAppStateKeys(
	storyId: string,
	scope: StoryStateScope,
	userId: string | null,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(s.storyAppState)
		.where(and(eq(s.storyAppState.storyId, storyId), eq(s.storyAppState.scope, scope), matchesUser(userId)))
		.execute();
	return row?.total ?? 0;
}

export async function upsertStoryAppState(
	stateKey: StoryAppStateKey,
	value: unknown,
	updatedBy: string,
): Promise<void> {
	await db
		.insert(s.storyAppState)
		.values({ ...stateKey, value, updatedBy })
		.onConflictDoUpdate({
			target:
				stateKey.scope === 'project'
					? [s.storyAppState.storyId, s.storyAppState.key]
					: [s.storyAppState.storyId, s.storyAppState.userId, s.storyAppState.key],
			targetWhere: stateKey.scope === 'project' ? sql`scope = 'project'` : sql`scope = 'user'`,
			set: { value, updatedBy, updatedAt: new Date() },
		})
		.execute();
}

export async function deleteStoryAppState(stateKey: StoryAppStateKey): Promise<void> {
	await db.delete(s.storyAppState).where(matchesKey(stateKey)).execute();
}

function matchesKey({ storyId, scope, userId, key }: StoryAppStateKey) {
	return and(
		eq(s.storyAppState.storyId, storyId),
		eq(s.storyAppState.scope, scope),
		eq(s.storyAppState.key, key),
		matchesUser(userId),
	);
}

function matchesUser(userId: string | null) {
	return userId === null ? isNull(s.storyAppState.userId) : eq(s.storyAppState.userId, userId);
}
