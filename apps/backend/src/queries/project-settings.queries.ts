import { eq } from 'drizzle-orm';

import s, { type DBProject } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

/** The provider settings blobs on `project` that hold more than one writer-editable field. */
export type ProjectMessagingSettingsKey =
	| 'slackSettings'
	| 'teamsSettings'
	| 'telegramSettings'
	| 'mattermostSettings'
	| 'whatsappSettings';

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	dbConfig.dialect === Dialect.Postgres ? (query as Query & Lockable<Query>).for('update') : query;

type Lockable<Query> = { for(strength: 'update'): Query };

/**
 * Rebuilds one of a project's messaging settings blobs in a transaction and returns the updated row,
 * or the row unchanged when `build` returns `undefined`.
 *
 * The body is written twice because the SQLite drivers are synchronous: better-sqlite3 rejects a
 * Promise-returning transaction callback outright, and Bun commits before an async body's awaited
 * writes run, so an async callback silently loses the transaction. Postgres needs the async form.
 * Same shape as `createProjectWithDefaultGroup` in project.queries.ts.
 */
export const updateProjectSettings = async <K extends ProjectMessagingSettingsKey>(
	projectId: string,
	key: K,
	build: (existing: DBProject[K]) => DBProject[K] | undefined,
): Promise<DBProject> => {
	const updateValues = (project: DBProject): { [P in K]: DBProject[P] } | undefined => {
		const settings = build(project[key]);
		return settings === undefined ? undefined : ({ [key]: settings } as { [P in K]: DBProject[P] });
	};

	return db.transaction((tx) => {
		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
				const project = await takeFirstOrThrow(
					lockForUpdate(tx.select().from(s.project).where(eq(s.project.id, projectId))).execute(),
					`Project not found: ${projectId}`,
				);
				const values = updateValues(project);
				if (!values) {
					return project;
				}
				return takeFirstOrThrow(
					tx.update(s.project).set(values).where(eq(s.project.id, projectId)).returning().execute(),
					`Project not found: ${projectId}`,
				);
			})();
		}

		const current = tx.select().from(s.project).where(eq(s.project.id, projectId)).get();
		if (!current) {
			throw new Error(`Project not found: ${projectId}`);
		}
		const values = updateValues(current);
		if (!values) {
			return current;
		}
		return tx.update(s.project).set(values).where(eq(s.project.id, projectId)).returning().get() ?? current;
	});
};
