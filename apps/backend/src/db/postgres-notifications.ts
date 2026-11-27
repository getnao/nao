import postgres from 'postgres';

import { env } from '../env';
import dbConfig, { Dialect } from './dbConfig';

export interface DatabaseNotifications {
	listen(channel: string, onNotify: (payload: string) => void): Promise<void>;
	notify(channel: string, payload: string): Promise<void>;
}

/**
 * Postgres `LISTEN/NOTIFY`, which reaches every backend instance sharing the database. It uses its own
 * client: listening holds a connection for good, so it stays out of the query pool. SQLite has none,
 * since a single instance can use it.
 */
export const databaseNotifications: DatabaseNotifications | null =
	dbConfig.dialect === Dialect.Postgres ? createPostgresNotifications() : null;

function createPostgresNotifications(): DatabaseNotifications {
	const sql = postgres(dbConfig.dbUrl, { ssl: env.DB_SSL ? 'require' : undefined, max: 2 });
	return {
		listen: async (channel, onNotify) => {
			await sql.listen(channel, onNotify);
		},
		notify: async (channel, payload) => {
			await sql.notify(channel, payload);
		},
	};
}
