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

	it('allows a recursive CTE with a column list', async () => {
		expect(
			await isReadOnlySqlQuery(
				'WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) SELECT n FROM t',
			),
		).toBe(true);
	});

	it('allows a CTE with a column list and a second plain CTE', async () => {
		expect(
			await isReadOnlySqlQuery('WITH a(x) AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b ON a.x = b.col'),
		).toBe(true);
	});

	it('allows multiple CTEs with column lists', async () => {
		expect(
			await isReadOnlySqlQuery('WITH a(x) AS (SELECT 1), b(y) AS (SELECT 2) SELECT * FROM a JOIN b ON a.x = b.y'),
		).toBe(true);
	});

	it('still blocks a DELETE behind a CTE with a column list', async () => {
		expect(await isReadOnlySqlQuery('WITH t(n) AS (SELECT 1) DELETE FROM t')).toBe(false);
	});

	it('still blocks a DELETE behind a column-list CTE with a second plain CTE', async () => {
		expect(await isReadOnlySqlQuery('WITH a(x) AS (SELECT 1), b AS (SELECT 2) DELETE FROM a')).toBe(false);
	});

	it('blocks a data-modifying CTE inside a column-list CTE body', async () => {
		expect(await isReadOnlySqlQuery('WITH a(x) AS (DELETE FROM t RETURNING *) SELECT * FROM a')).toBe(false);
	});

	it('blocks a data-modifying CTE inside a plain CTE body', async () => {
		expect(await isReadOnlySqlQuery('WITH cte AS (DELETE FROM users RETURNING *) SELECT * FROM cte')).toBe(false);
	});

	it('blocks an INSERT inside a CTE body', async () => {
		expect(await isReadOnlySqlQuery('WITH cte AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM cte')).toBe(
			false,
		);
	});

	it('blocks a data-modifying second CTE body alongside a read CTE', async () => {
		expect(
			await isReadOnlySqlQuery('WITH a(x) AS (SELECT 1), b AS (DELETE FROM t RETURNING *) SELECT * FROM a'),
		).toBe(false);
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
