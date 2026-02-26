import { describe, expect, it } from 'vitest';

import { isReadOnlySqlQuery } from '../src/utils/sql-filter';

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
