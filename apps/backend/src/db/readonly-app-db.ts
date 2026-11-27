import postgres from 'postgres';

import { env } from '../env';
import type { CostLookupTuple } from '../queries/usage.queries';
import { getScopedViews } from './app-db-views';
import dbConfig, { Dialect } from './dbConfig';

export interface AppDbQueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
}

const APP_DB_STATEMENT_TIMEOUT_MS = 30_000;
const MODEL_COST_KEY_COLUMNS = ['provider', 'model_id', 'llm_config_id'];
const MODEL_COST_PRICE_COLUMNS = ['input_no_cache', 'input_cache_read', 'input_cache_write', 'output'];
const MODEL_COST_COLUMNS = [...MODEL_COST_KEY_COLUMNS, ...MODEL_COST_PRICE_COLUMNS];
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;

/**
 * The app tables store `timestamp without time zone`. Parsing those into JS Dates
 * reinterprets them in the server's local zone, which shifts a `date_trunc('day', ...)`
 * bucket onto the previous day once it is serialised back to UTC. Keep them as the
 * strings Postgres returned.
 */
const NAIVE_DATE_TYPES = {
	naiveDate: {
		to: TIMESTAMP_OID,
		from: [DATE_OID, TIMESTAMP_OID],
		serialize: (value: string) => value,
		parse: (value: string) => value,
	},
};

/** Model prices go in a temp table so the views price tokens on the fly, never stored, with each project's own prices. */
export async function runScopedAppDbQuery(
	projectId: string,
	sql: string,
	modelCosts: readonly CostLookupTuple[] = [],
): Promise<AppDbQueryResult> {
	if (dbConfig.dialect === Dialect.Postgres) {
		return runPostgres(projectId, sql, modelCosts);
	}
	return runSqlite(projectId, sql, modelCosts);
}

interface SqliteConnection {
	exec(sql: string): unknown;
	prepare(sql: string): { run(...params: unknown[]): unknown; all(): unknown[] };
	close(): void;
}

async function runSqlite(
	projectId: string,
	sql: string,
	modelCosts: readonly CostLookupTuple[],
): Promise<AppDbQueryResult> {
	const conn = await openSqlite();
	try {
		conn.exec('CREATE TEMP TABLE _scope (project_id TEXT NOT NULL)');
		conn.prepare('INSERT INTO _scope (project_id) VALUES (?)').run(projectId);
		conn.exec(modelCostTableDdl('real'));
		const insertModelCost = conn.prepare('INSERT INTO _model_cost VALUES (?, ?, ?, ?, ?, ?, ?)');
		for (const modelCost of modelCosts) {
			insertModelCost.run(...modelCost);
		}
		for (const view of getScopedViews()) {
			conn.exec(`CREATE TEMP VIEW ${view.name} AS ${view.body}`);
		}
		// Belt-and-suspenders: block any write that slipped past the validator.
		conn.exec('PRAGMA query_only = ON');
		const rows = conn.prepare(sql).all() as Record<string, unknown>[];
		return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
	} finally {
		conn.close();
	}
}

/**
 * Production runs under Bun (bun:sqlite); tests run under Node (better-sqlite3).
 * better-sqlite3's native binding does not load under Bun, so the driver is chosen by runtime.
 */
async function openSqlite(): Promise<SqliteConnection> {
	if (typeof Bun !== 'undefined') {
		const { Database } = await import('bun:sqlite');
		return new Database(dbConfig.dbUrl) as unknown as SqliteConnection;
	}
	const { default: Database } = await import('better-sqlite3');
	return new Database(dbConfig.dbUrl) as unknown as SqliteConnection;
}

async function runPostgres(
	projectId: string,
	sql: string,
	modelCosts: readonly CostLookupTuple[],
): Promise<AppDbQueryResult> {
	const ssl = env.DB_SSL ? 'require' : undefined;
	const client = postgres(dbConfig.dbUrl, { ssl, max: 1, types: NAIVE_DATE_TYPES });
	try {
		// Build the project-scoped sandbox in a read-write setup transaction. The temp
		// objects are session-scoped (no ON COMMIT DROP) so they survive into the
		// read-only query transaction below; they drop when the connection closes.
		await client.begin(async (tx) => {
			await tx`CREATE TEMP TABLE _scope (project_id text NOT NULL)`;
			await tx`INSERT INTO _scope (project_id) VALUES (${projectId})`;
			await tx.unsafe(modelCostTableDdl('double precision'));
			if (modelCosts.length > 0) {
				await tx`INSERT INTO _model_cost ${tx(modelCosts.map(toModelCostRow))}`;
			}
			for (const view of getScopedViews()) {
				await tx.unsafe(`CREATE TEMP VIEW ${view.name} AS ${view.body}`);
			}
		});
		// Run the caller's query in a read-only transaction so any write that slipped
		// past the validator is rejected at the database level (parity with SQLite's
		// query_only pragma). CREATE is disallowed under READ ONLY, hence the split.
		return await client.begin(async (tx) => {
			await tx`SET TRANSACTION READ ONLY`;
			// The validator's function-call lexer reads plain strings with standard (non-backslash) escaping.
			await tx`SET LOCAL standard_conforming_strings = on`;
			// Caps runaway queries (huge cross joins, generate_series) so one tool call cannot pin the database.
			await tx.unsafe(`SET LOCAL statement_timeout = ${APP_DB_STATEMENT_TIMEOUT_MS}`);
			const rows = (await tx.unsafe(sql)) as unknown as Record<string, unknown>[];
			return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows: [...rows] };
		});
	} finally {
		await client.end({ timeout: 5 });
	}
}

/** One row per provider, model and credential, with its price per million tokens. */
function modelCostTableDdl(priceType: 'real' | 'double precision'): string {
	const columns = [
		...MODEL_COST_KEY_COLUMNS.map((column) => `${column} text NOT NULL`),
		...MODEL_COST_PRICE_COLUMNS.map((column) => `${column} ${priceType} NOT NULL`),
	];
	return `CREATE TEMP TABLE _model_cost (${columns.join(', ')})`;
}

function toModelCostRow(modelCost: CostLookupTuple): Record<string, string | number> {
	return Object.fromEntries(MODEL_COST_COLUMNS.map((column, index) => [column, modelCost[index]]));
}
