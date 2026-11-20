import { describe, expect, it } from 'vitest';

import { detectQueryRowLimit, isReadOnlySqlQuery } from '../../src/utils/sql-filter';

describe('isReadOnlySqlQuery', () => {
	it.each([
		['allows a simple SELECT', 'SELECT * FROM users'],
		['allows a SELECT with WHERE clause', 'SELECT id, name FROM users WHERE active = true'],
		['allows a SELECT with JOIN', 'SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id'],
		['allows a SELECT with subquery', 'SELECT * FROM (SELECT id FROM users) sub'],
		['allows a WITH (CTE) SELECT', 'WITH cte AS (SELECT id FROM users) SELECT * FROM cte'],
		[
			'allows a recursive CTE with a column list',
			'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) SELECT n FROM t',
		],
		[
			'allows a CTE with a column list and a second plain CTE',
			'WITH a(x) AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b ON a.x = b.col',
		],
		[
			'allows multiple CTEs with column lists',
			'WITH a(x) AS (SELECT 1), b(y) AS (SELECT 2) SELECT * FROM a JOIN b ON a.x = b.y',
		],
		['allows a multi-statement batch of only SELECTs', 'SELECT 1; SELECT 2'],
	])('%s', async (_name, sql) => {
		expect(await isReadOnlySqlQuery(sql)).toBe(true);
	});

	it.each([
		['still blocks a DELETE behind a CTE with a column list', 'WITH t(n) AS (SELECT 1) DELETE FROM t'],
		[
			'still blocks a DELETE behind a column-list CTE with a second plain CTE',
			'WITH a(x) AS (SELECT 1), b AS (SELECT 2) DELETE FROM a',
		],
		[
			'blocks a data-modifying CTE inside a column-list CTE body',
			'WITH a(x) AS (DELETE FROM t RETURNING *) SELECT * FROM a',
		],
		[
			'blocks a data-modifying CTE inside a plain CTE body',
			'WITH cte AS (DELETE FROM users RETURNING *) SELECT * FROM cte',
		],
		['blocks an INSERT inside a CTE body', 'WITH cte AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM cte'],
		[
			'blocks a data-modifying second CTE body alongside a read CTE',
			'WITH a(x) AS (SELECT 1), b AS (DELETE FROM t RETURNING *) SELECT * FROM a',
		],
		['blocks INSERT', "INSERT INTO users (name) VALUES ('alice')"],
		['blocks UPDATE', "UPDATE users SET name = 'bob' WHERE id = 1"],
		['blocks DELETE', 'DELETE FROM users WHERE id = 1'],
		['blocks DROP TABLE', 'DROP TABLE users'],
		['blocks CREATE TABLE', 'CREATE TABLE foo (id INT)'],
		['blocks TRUNCATE', 'TRUNCATE TABLE users'],
		['blocks a multi-statement batch containing a write', 'SELECT * FROM users; DELETE FROM users'],
	])('%s', async (_name, sql) => {
		expect(await isReadOnlySqlQuery(sql)).toBe(false);
	});
});

describe('isReadOnlySqlQuery blocks catalog/server-passthrough functions', () => {
	const blockedFunctions = [
		'postgres_query',
		'postgres_execute',
		'postgres_scan',
		'postgres_scan_pushdown',
		'mysql_query',
		'mysql_execute',
		'sqlite_query',
		'sqlite_scan',
		'json_execute_serialized_sql',
	];

	it.each(blockedFunctions)('blocks a top-level call to %s', async (fn) => {
		expect(await isReadOnlySqlQuery(`SELECT * FROM ${fn}('conn', 'SELECT 1')`)).toBe(false);
	});

	it.each(blockedFunctions)('blocks %s reached through a CTE', async (fn) => {
		expect(
			await isReadOnlySqlQuery(`WITH leak AS (SELECT * FROM ${fn}('conn', 'SELECT 1')) SELECT * FROM leak`),
		).toBe(false);
	});

	it.each(blockedFunctions)('blocks %s reached through a subquery', async (fn) => {
		expect(await isReadOnlySqlQuery(`SELECT * FROM (SELECT * FROM ${fn}('conn', 'SELECT 1')) sub`)).toBe(false);
	});

	it.each([
		[
			'blocks the reported exploit payload against the DuckLake metadata catalog',
			"SELECT * FROM postgres_query('__ducklake_metadata_lake', 'SELECT rolname, rolpassword FROM pg_authid')",
		],
		[
			'blocks extra whitespace between the function name and the parenthesis',
			"SELECT * FROM postgres_query   ('conn', 'SELECT 1')",
		],
		['blocks mixed-case function names', "SELECT * FROM Postgres_Query('conn', 'SELECT 1')"],
		[
			'blocks a comment inserted between the function name and the parenthesis',
			"SELECT * FROM postgres_query/**/('conn', 'SELECT 1')",
		],
		['blocks a double-quoted function name', "SELECT * FROM \"postgres_query\"('conn', 'SELECT 1')"],
	])('%s', async (_name, sql) => {
		expect(await isReadOnlySqlQuery(sql)).toBe(false);
	});

	it.each([
		[
			'allows a column named after a blocked function with a suffix',
			'SELECT postgres_query_log_id FROM audit_events',
		],
		['allows a table named after a blocked function with a suffix', 'SELECT * FROM postgres_query_log'],
		[
			'allows a string literal that merely mentions a blocked function name',
			"SELECT * FROM events WHERE note = 'ran postgres_query(x) once'",
		],
	])('%s', async (_name, sql) => {
		expect(await isReadOnlySqlQuery(sql)).toBe(true);
	});
});

describe('detectQueryRowLimit', () => {
	it.each([
		['returns null when there is no limit', 'SELECT * FROM games', null],
		['detects a trailing LIMIT', 'SELECT * FROM games ORDER BY total_downloads DESC LIMIT 20', 20],
		['detects LIMIT regardless of case and whitespace', 'select * from games\n  limit   5', 5],
		['detects the count in MySQL "LIMIT offset, count" syntax', 'SELECT * FROM games LIMIT 40, 20', 20],
		['detects the count in "LIMIT count OFFSET n" syntax', 'SELECT * FROM games LIMIT 20 OFFSET 40', 20],
		['detects T-SQL TOP n', 'SELECT TOP 20 * FROM games', 20],
		['detects T-SQL TOP (n)', 'SELECT TOP (20) * FROM games', 20],
		['ignores TOP n PERCENT', 'SELECT TOP 10 PERCENT * FROM games', null],
		['detects FETCH FIRST n ROWS ONLY', 'SELECT * FROM games ORDER BY id FETCH FIRST 20 ROWS ONLY', 20],
		['ignores a LIMIT inside a subquery', 'SELECT count(*) FROM (SELECT id FROM games LIMIT 20) sub', null],
		[
			'detects the outer LIMIT when a subquery also has one',
			'SELECT * FROM (SELECT id FROM games LIMIT 100) sub LIMIT 20',
			20,
		],
		['ignores the word LIMIT inside a string literal', "SELECT * FROM games WHERE note = 'LIMIT 5'", null],
	])('%s', (_name, sql, expected) => {
		expect(detectQueryRowLimit(sql)).toBe(expected);
	});
});
