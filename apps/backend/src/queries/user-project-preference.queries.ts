import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
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
	return mutateUserProjectPreferences(userId, projectId, (current) => ({ ...current, ...partial }));
}

export async function mutateUserProjectPreferences(
	userId: string,
	projectId: string,
	transform: (current: UserProjectPreferences) => UserProjectPreferences,
): Promise<UserProjectPreferences> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((tx) => {
			const insert = tx
				.insert(s.userProjectPreference)
				.values({ userId, projectId, preferences: {} })
				.onConflictDoNothing() as unknown as SQLiteRunnable;
			insert.run();
			const select = tx
				.select({ preferences: s.userProjectPreference.preferences })
				.from(s.userProjectPreference)
				.where(
					and(eq(s.userProjectPreference.userId, userId), eq(s.userProjectPreference.projectId, projectId)),
				) as unknown as SQLiteSelectable<{ preferences: UserProjectPreferences }>;
			const preferences = transform(select.all()[0]?.preferences ?? {});
			const update = tx
				.update(s.userProjectPreference)
				.set({ preferences, updatedAt: new Date() })
				.where(
					and(eq(s.userProjectPreference.userId, userId), eq(s.userProjectPreference.projectId, projectId)),
				) as unknown as SQLiteRunnable;
			update.run();
			return preferences;
		});
	}

	return db.transaction(async (tx) => {
		await tx
			.insert(s.userProjectPreference)
			.values({ userId, projectId, preferences: {} })
			.onConflictDoNothing()
			.execute();

		const base = tx
			.select({ preferences: s.userProjectPreference.preferences })
			.from(s.userProjectPreference)
			.where(and(eq(s.userProjectPreference.userId, userId), eq(s.userProjectPreference.projectId, projectId)));
		const [row] = await lockForUpdate(base).execute();
		const preferences = transform(row?.preferences ?? {});

		await tx
			.update(s.userProjectPreference)
			.set({ preferences, updatedAt: new Date() })
			.where(and(eq(s.userProjectPreference.userId, userId), eq(s.userProjectPreference.projectId, projectId)))
			.execute();

		return preferences;
	});
}

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	(query as Query & Lockable<Query>).for('update');

type Lockable<Query> = { for(strength: 'update'): Query };
type SQLiteRunnable = { run(): unknown };
type SQLiteSelectable<Row> = { all(): Row[] };
