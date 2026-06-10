import type { UserPreferences } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getUserPreferences = async (userId: string): Promise<UserPreferences> => {
	const [row] = await db
		.select({ preferences: s.userPreference.preferences })
		.from(s.userPreference)
		.where(eq(s.userPreference.userId, userId))
		.execute();

	return row?.preferences ?? {};
};

export const updateUserPreferences = async (userId: string, partial: UserPreferences): Promise<UserPreferences> => {
	const current = await getUserPreferences(userId);
	const preferences = { ...current, ...partial };

	await db
		.insert(s.userPreference)
		.values({ userId, preferences })
		.onConflictDoUpdate({
			target: s.userPreference.userId,
			set: { preferences, updatedAt: new Date() },
		})
		.execute();

	return preferences;
};
