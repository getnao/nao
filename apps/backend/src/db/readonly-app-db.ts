import postgres from 'postgres';

import { env } from '../env';
import { getScopedViews } from './app-db-views';
import dbConfig, { Dialect } from './dbConfig';

export interface AppDbQueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
}

export async function runScopedAppDbQuery(projectId: string, sql: string): Promise<AppDbQueryResult> {
	if (dbConfig.dialect === Dialect.Postgres) {
		return runPostgres(projectId, sql);
	}
	return runSqlite(projectId, sql);
}

async function runSqlite(projectId: string, sql: string): Promise<AppDbQueryResult> {
	// Production runs under Bun (bun:sqlite); tests run under Node (better-sqlite3).
	// better-sqlite3's native binding does not load under Bun, so the driver is chosen by runtime.
	if (typeof Bun !== 'undefined') {
		const { Database } = await import('bun:sqlite');
		const conn = new Database(dbConfig.dbUrl);
		try {
			conn.run('CREATE TEMP TABLE _scope (project_id TEXT NOT NULL)');
			conn.query('INSERT INTO _scope (project_id) VALUES (?)').run(projectId);
			for (const view of getScopedViews()) {
				conn.run(`CREATE TEMP VIEW ${view.name} AS ${view.body}`);
			}
			conn.run('PRAGMA query_only = ON');
			const rows = conn.query(sql).all() as Record<string, unknown>[];
			return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
		} finally {
			conn.close();
		}
	}

	const { default: Database } = await import('better-sqlite3');
	const conn = new Database(dbConfig.dbUrl);
	try {
		conn.exec('CREATE TEMP TABLE _scope (project_id TEXT NOT NULL)');
		conn.prepare('INSERT INTO _scope (project_id) VALUES (?)').run(projectId);
		for (const view of getScopedViews()) {
			conn.exec(`CREATE TEMP VIEW ${view.name} AS ${view.body}`);
		}
		// Belt-and-suspenders: block any write that slipped past the validator.
		conn.pragma('query_only = ON');
		const rows = conn.prepare(sql).all() as Record<string, unknown>[];
		return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
	} finally {
		conn.close();
	}
}

async function runPostgres(projectId: string, sql: string): Promise<AppDbQueryResult> {
	const ssl = env.DB_SSL ? 'require' : undefined;
	const client = postgres(dbConfig.dbUrl, { ssl, max: 1 });
	try {
		// Build the project-scoped sandbox in a read-write setup transaction. The temp
		// objects are session-scoped (no ON COMMIT DROP) so they survive into the
		// read-only query transaction below; they drop when the connection closes.
		await client.begin(async (tx) => {
			await tx`CREATE TEMP TABLE _scope (project_id text NOT NULL)`;
			await tx`INSERT INTO _scope (project_id) VALUES (${projectId})`;
			for (const view of getScopedViews()) {
				await tx.unsafe(`CREATE TEMP VIEW ${view.name} AS ${view.body}`);
			}
		});
		// Run the caller's query in a read-only transaction so any write that slipped
		// past the validator is rejected at the database level (parity with SQLite's
		// query_only pragma). CREATE is disallowed under READ ONLY, hence the split.
		return await client.begin(async (tx) => {
			await tx`SET TRANSACTION READ ONLY`;
			const rows = (await tx.unsafe(sql)) as unknown as Record<string, unknown>[];
			return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows: [...rows] };
		});
	} finally {
		await client.end({ timeout: 5 });
	}
}
