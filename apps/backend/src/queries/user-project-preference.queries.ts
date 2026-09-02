import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { UserProjectPreferences } from '../types/usage';

export async function getUserProjectPreferences(userId: string, projectId: string): Promise<UserProjectPreferences> {
	const [row] = await db
		.select({ preferences: s.userProjectPreference.preferences })
		.from(s.userProjectPreference)
		.where(and(eq(s.userProjectPreference.userId, userId), eq(s.userProjectPreference.projectId, projectId)))
		.execute();

	return row?.preferences ?? {};
}

export async function updateUserProjectPreferences(
	userId: string,
	projectId: string,
	partial: Partial<UserProjectPreferences>,
): Promise<UserProjectPreferences> {
	const current = await getUserProjectPreferences(userId, projectId);
	const preferences = { ...current, ...partial };

	await db
		.insert(s.userProjectPreference)
		.values({ userId, projectId, preferences })
		.onConflictDoUpdate({
			target: [s.userProjectPreference.userId, s.userProjectPreference.projectId],
			set: { preferences, updatedAt: new Date() },
		})
		.execute();

	return preferences;
}
