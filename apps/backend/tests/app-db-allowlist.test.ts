import { describe, expect, it } from 'vitest';

import { Dialect } from '../src/db/dbConfig';
import { validateAppDbQuery } from '../src/utils/app-db-allowlist';

describe.each([Dialect.Sqlite, Dialect.Postgres])('validateAppDbQuery (%s)', (dialect) => {
	it('allows a SELECT over an allowlisted view', async () => {
		expect((await validateAppDbQuery('SELECT chat_id FROM v_messages', dialect)).ok).toBe(true);
	});

	it('allows a JOIN across allowlisted views', async () => {
		const sql = 'SELECT m.chat_id FROM v_messages m JOIN v_memories mem ON mem.chat_id = m.chat_id';
		expect((await validateAppDbQuery(sql, dialect)).ok).toBe(true);
	});

	it('allows a CTE over allowlisted views', async () => {
		const sql = 'WITH t AS (SELECT chat_id FROM v_messages) SELECT * FROM t';
		expect((await validateAppDbQuery(sql, dialect)).ok).toBe(true);
	});

	it('rejects a write', async () => {
		expect((await validateAppDbQuery("UPDATE v_messages SET title = 'x'", dialect)).ok).toBe(false);
	});

	it('rejects a base table (not a view)', async () => {
		const res = await validateAppDbQuery('SELECT * FROM chat', dialect);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('chat');
	});

	it('rejects an auth/PII table', async () => {
		expect((await validateAppDbQuery('SELECT password FROM account', dialect)).ok).toBe(false);
	});

	it('rejects unparseable SQL, naming the dialect and the parser error', async () => {
		const res = await validateAppDbQuery('SELECT FROM WHERE )(', dialect);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain(dialect === Dialect.Postgres ? 'PostgreSQL' : 'SQLite');
		expect(res.reason).toContain('Expected');
	});
});

describe('validateAppDbQuery postgres syntax', () => {
	it('allows EXTRACT(EPOCH FROM ... INTERVAL ...)', async () => {
		const sql = `SELECT DATE(to_timestamp(created_at)) AS day, chat_source, COUNT(*) AS message_count
			FROM v_messages
			WHERE role = 'user' AND created_at >= EXTRACT(EPOCH FROM NOW() - INTERVAL '15 days')
			GROUP BY 1, 2
			ORDER BY 1, 2`;
		expect((await validateAppDbQuery(sql, Dialect.Postgres)).ok).toBe(true);
	});

	it('allows an aggregate FILTER clause', async () => {
		const sql = "SELECT COUNT(*) FILTER (WHERE role = 'user') AS user_messages FROM v_messages";
		expect((await validateAppDbQuery(sql, Dialect.Postgres)).ok).toBe(true);
	});

	it('rejects postgres-only syntax when the app runs on SQLite', async () => {
		const sql = "SELECT COUNT(*) FILTER (WHERE role = 'user') AS user_messages FROM v_messages";
		expect((await validateAppDbQuery(sql, Dialect.Sqlite)).ok).toBe(false);
	});

	it('includes the parser error when an alias is a reserved word', async () => {
		const res = await validateAppDbQuery('SELECT COUNT(*) as count FROM v_messages', Dialect.Sqlite);
		expect(res.ok).toBe(false);
		expect(res.reason).toMatch(/count.*reserved word/i);
	});
});
