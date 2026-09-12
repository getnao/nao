import { describe, expect, it } from 'vitest';

import { detectQueryRowLimit, isReadOnlySqlQuery } from '../src/utils/sql-filter';

describe('isReadOnlySqlQuery', () => {
	it('allows a simple SELECT', async () => {
		expect(await isReadOnlySqlQuery('SELECT * FROM users')).toBe(true);
	});

	it('allows a SELECT with WHERE clause', async () => {
		expect(await isReadOnlySqlQuery('SELECT id, name FROM users WHERE active = true')).toBe(true);
	});

	it('allows a SELECT with JOIN', async () => {
		expect(await isReadOnlySqlQuery('SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id')).toBe(
			true,
		);
	});

	it('allows a SELECT with subquery', async () => {
		expect(await isReadOnlySqlQuery('SELECT * FROM (SELECT id FROM users) sub')).toBe(true);
	});

	it('allows a WITH (CTE) SELECT', async () => {
		expect(await isReadOnlySqlQuery('WITH cte AS (SELECT id FROM users) SELECT * FROM cte')).toBe(true);
	});

	it('blocks INSERT', async () => {
		expect(await isReadOnlySqlQuery("INSERT INTO users (name) VALUES ('alice')")).toBe(false);
	});

	it('blocks UPDATE', async () => {
		expect(await isReadOnlySqlQuery("UPDATE users SET name = 'bob' WHERE id = 1")).toBe(false);
	});

	it('blocks DELETE', async () => {
		expect(await isReadOnlySqlQuery('DELETE FROM users WHERE id = 1')).toBe(false);
	});

	it('blocks DROP TABLE', async () => {
		expect(await isReadOnlySqlQuery('DROP TABLE users')).toBe(false);
	});

	it('blocks CREATE TABLE', async () => {
		expect(await isReadOnlySqlQuery('CREATE TABLE foo (id INT)')).toBe(false);
	});

	it('blocks TRUNCATE', async () => {
		expect(await isReadOnlySqlQuery('TRUNCATE TABLE users')).toBe(false);
	});

	it('blocks a multi-statement batch containing a write', async () => {
		expect(await isReadOnlySqlQuery('SELECT * FROM users; DELETE FROM users')).toBe(false);
	});

	it('allows a multi-statement batch of only SELECTs', async () => {
		expect(await isReadOnlySqlQuery('SELECT 1; SELECT 2')).toBe(true);
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

	it('blocks the reported exploit payload against the DuckLake metadata catalog', async () => {
		const exploit =
			"SELECT * FROM postgres_query('__ducklake_metadata_lake', 'SELECT rolname, rolpassword FROM pg_authid')";
		expect(await isReadOnlySqlQuery(exploit)).toBe(false);
	});

	it('blocks extra whitespace between the function name and the parenthesis', async () => {
		expect(await isReadOnlySqlQuery("SELECT * FROM postgres_query   ('conn', 'SELECT 1')")).toBe(false);
	});

	it('blocks mixed-case function names', async () => {
		expect(await isReadOnlySqlQuery("SELECT * FROM Postgres_Query('conn', 'SELECT 1')")).toBe(false);
	});

	it('blocks a comment inserted between the function name and the parenthesis', async () => {
		expect(await isReadOnlySqlQuery("SELECT * FROM postgres_query/**/('conn', 'SELECT 1')")).toBe(false);
	});

	it('blocks a double-quoted function name', async () => {
		expect(await isReadOnlySqlQuery("SELECT * FROM \"postgres_query\"('conn', 'SELECT 1')")).toBe(false);
	});

	it('allows a column named after a blocked function with a suffix', async () => {
		expect(await isReadOnlySqlQuery('SELECT postgres_query_log_id FROM audit_events')).toBe(true);
	});

	it('allows a table named after a blocked function with a suffix', async () => {
		expect(await isReadOnlySqlQuery('SELECT * FROM postgres_query_log')).toBe(true);
	});

	it('allows a string literal that merely mentions a blocked function name', async () => {
		expect(await isReadOnlySqlQuery("SELECT * FROM events WHERE note = 'ran postgres_query(x) once'")).toBe(true);
	});
});

describe('detectQueryRowLimit', () => {
	it('returns null when there is no limit', () => {
		expect(detectQueryRowLimit('SELECT * FROM games')).toBeNull();
	});

	it('detects a trailing LIMIT', () => {
		expect(detectQueryRowLimit('SELECT * FROM games ORDER BY total_downloads DESC LIMIT 20')).toBe(20);
	});

	it('detects LIMIT regardless of case and whitespace', () => {
		expect(detectQueryRowLimit('select * from games\n  limit   5')).toBe(5);
	});

	it('detects the count in MySQL "LIMIT offset, count" syntax', () => {
		expect(detectQueryRowLimit('SELECT * FROM games LIMIT 40, 20')).toBe(20);
	});

	it('detects the count in "LIMIT count OFFSET n" syntax', () => {
		expect(detectQueryRowLimit('SELECT * FROM games LIMIT 20 OFFSET 40')).toBe(20);
	});

	it('detects T-SQL TOP n', () => {
		expect(detectQueryRowLimit('SELECT TOP 20 * FROM games')).toBe(20);
	});

	it('detects T-SQL TOP (n)', () => {
		expect(detectQueryRowLimit('SELECT TOP (20) * FROM games')).toBe(20);
	});

	it('ignores TOP n PERCENT', () => {
		expect(detectQueryRowLimit('SELECT TOP 10 PERCENT * FROM games')).toBeNull();
	});

	it('detects FETCH FIRST n ROWS ONLY', () => {
		expect(detectQueryRowLimit('SELECT * FROM games ORDER BY id FETCH FIRST 20 ROWS ONLY')).toBe(20);
	});

	it('ignores a LIMIT inside a subquery', () => {
		expect(detectQueryRowLimit('SELECT count(*) FROM (SELECT id FROM games LIMIT 20) sub')).toBeNull();
	});

	it('detects the outer LIMIT when a subquery also has one', () => {
		expect(detectQueryRowLimit('SELECT * FROM (SELECT id FROM games LIMIT 100) sub LIMIT 20')).toBe(20);
	});

	it('ignores the word LIMIT inside a string literal', () => {
		expect(detectQueryRowLimit("SELECT * FROM games WHERE note = 'LIMIT 5'")).toBeNull();
	});
});
