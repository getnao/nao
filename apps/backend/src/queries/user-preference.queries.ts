import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { StoredUserPreferences } from '../types/usage';

export async function getUserPreferences(userId: string): Promise<StoredUserPreferences> {
	const [row] = await db
		.select({ preferences: s.userPreference.preferences })
		.from(s.userPreference)
		.where(eq(s.userPreference.userId, userId))
		.execute();

	return row?.preferences ?? {};
}

export async function updateUserPreferences(
	userId: string,
	partial: Partial<StoredUserPreferences>,
): Promise<StoredUserPreferences> {
	return mutateUserPreferences(userId, (current) => ({ ...current, ...partial }));
}

export async function mutateUserPreferences(
	userId: string,
	transform: (current: StoredUserPreferences) => StoredUserPreferences,
): Promise<StoredUserPreferences> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((tx) => {
			const insert = tx
				.insert(s.userPreference)
				.values({ userId, preferences: {} })
				.onConflictDoNothing() as unknown as SQLiteRunnable;
			insert.run();
			const select = tx
				.select({ preferences: s.userPreference.preferences })
				.from(s.userPreference)
				.where(eq(s.userPreference.userId, userId)) as unknown as SQLiteSelectable<{
				preferences: StoredUserPreferences;
			}>;
			const preferences = transform(select.all()[0]?.preferences ?? {});
			const update = tx
				.update(s.userPreference)
				.set({ preferences, updatedAt: new Date() })
				.where(eq(s.userPreference.userId, userId)) as unknown as SQLiteRunnable;
			update.run();
			return preferences;
		});
	}

	return db.transaction(async (tx) => {
		await tx.insert(s.userPreference).values({ userId, preferences: {} }).onConflictDoNothing().execute();

		const base = tx
			.select({ preferences: s.userPreference.preferences })
			.from(s.userPreference)
			.where(eq(s.userPreference.userId, userId));
		const [row] = await lockForUpdate(base).execute();
		const preferences = transform(row?.preferences ?? {});

		await tx
			.update(s.userPreference)
			.set({ preferences, updatedAt: new Date() })
			.where(eq(s.userPreference.userId, userId))
			.execute();

		return preferences;
	});
}

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	(query as Query & Lockable<Query>).for('update');

type Lockable<Query> = { for(strength: 'update'): Query };
type SQLiteRunnable = { run(): unknown };
type SQLiteSelectable<Row> = { all(): Row[] };
