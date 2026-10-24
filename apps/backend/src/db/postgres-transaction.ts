import { db, type DBExecutor } from './db';
import dbConfig, { Dialect } from './dbConfig';

/**
 * Runs `fn` in a transaction on Postgres. SQLite drivers cannot keep a transaction open across awaits,
 * so there `fn` runs on the connection directly.
 */
export const withPostgresTransaction = <T>(fn: (executor: DBExecutor) => Promise<T>): Promise<T> =>
	dbConfig.dialect === Dialect.Postgres ? db.transaction(fn) : fn(db);
