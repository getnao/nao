import dbConfig, { Dialect } from './dbConfig';

type Lockable<Query> = { for(strength: 'update'): Query };

/** Adds `FOR UPDATE` on Postgres; SQLite has no row locks, so the query is left as is. */
export const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	dbConfig.dialect === Dialect.Postgres ? (query as Query & Lockable<Query>).for('update') : query;
