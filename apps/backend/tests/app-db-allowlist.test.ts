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

	it('allows a CTE that reads an earlier CTE', async () => {
		const sql = 'WITH a AS (SELECT chat_id FROM v_messages), b AS (SELECT * FROM a) SELECT * FROM b';
		expect((await validateAppDbQuery(sql, dialect)).ok).toBe(true);
	});

	it('allows a recursive CTE that reads itself', async () => {
		const sql =
			'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3) SELECT * FROM n, v_project';
		expect((await validateAppDbQuery(sql, dialect)).ok).toBe(true);
	});

	it('allows a trailing semicolon', async () => {
		expect((await validateAppDbQuery('SELECT chat_id FROM v_messages;', dialect)).ok).toBe(true);
	});

	it('rejects a schema-qualified base table shadowed by a CTE of the same name', async () => {
		const res = await validateAppDbQuery(
			`WITH "user" AS (SELECT 1) SELECT string_agg(email, ',') FROM public."user"`,
			dialect,
		);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('references objects outside the allowlist: public.user');
	});

	it('rejects a schema-qualified allowlisted name', async () => {
		expect((await validateAppDbQuery('SELECT * FROM public.v_messages', dialect)).ok).toBe(false);
	});

	it('rejects a CTE whose body reads the base table it is named after', async () => {
		const res = await validateAppDbQuery('WITH chat AS (SELECT * FROM chat) SELECT * FROM chat', dialect);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('chat');
	});

	it('rejects a CTE that reads a later CTE named after a base table', async () => {
		const sql = 'WITH a AS (SELECT * FROM chat), chat AS (SELECT chat_id FROM v_messages) SELECT * FROM a';
		expect((await validateAppDbQuery(sql, dialect)).ok).toBe(false);
	});

	it('rejects a CTE in one statement masking a base table in another', async () => {
		const res = await validateAppDbQuery('WITH "user" AS (SELECT 1) SELECT 1; SELECT * FROM "user"', dialect);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('single');
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

	it.each([
		["SELECT query_to_xml('select * from public.user', true, true, '')", 'query_to_xml'],
		["SELECT table_to_xml('public.user', true, true, '') FROM v_project", 'table_to_xml'],
		["SELECT * FROM ts_stat('select to_tsvector(email) from public.user')", 'ts_stat'],
		["SELECT set_config('role', 'none', true) FROM v_project", 'set_config'],
		[`SELECT "query_to_xml"('select 1', true, true, '') FROM v_project`, 'query_to_xml'],
		["SELECT pg_catalog.lower('A') FROM v_project", 'lower'],
		[
			"WITH query_to_xml AS (SELECT 1) SELECT query_to_xml('select * from public.user', true, true, '') FROM v_project",
			'query_to_xml',
		],
		[
			"WITH query_to_xml(a) AS (SELECT 1) SELECT query_to_xml('select 1', true, true, '') FROM v_project",
			'query_to_xml',
		],
		['SELECT pg_sleep/* outer /* inner */ tail */(1) FROM v_project', 'pg_sleep'],
	])('rejects a function call outside the allowlist: %s', async (sql, functionName) => {
		const res = await validateAppDbQuery(sql, Dialect.Postgres);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain(functionName);
	});

	it.each([
		["SELECT E'\\'', query_to_xml('select 1', true, true, '') FROM v_project --'"],
		['SELECT $$x$$ FROM v_project'],
		["SELECT 'unterminated FROM v_project"],
	])('rejects literals the function check cannot read exactly: %s', async (sql) => {
		expect((await validateAppDbQuery(sql, Dialect.Postgres)).ok).toBe(false);
	});

	it.each([
		["SELECT 'query_to_xml(' AS label, COUNT(*) FROM v_messages"],
		['SELECT CAST(AVG(created_at) AS numeric(12, 2)) FROM v_messages'],
		['SELECT g.n FROM v_project, generate_series(1, 3) AS g(n)'],
		['WITH t(a, b) AS (SELECT chat_id, role FROM v_messages) SELECT a FROM t'],
		['SELECT chat_id FROM v_messages ORDER BY random() LIMIT 10'],
		["SELECT format('%s-%s', chat_id, role) FROM v_messages"],
		["SELECT date_trunc('day', to_timestamp(created_at)) AS day, COUNT(*) FROM v_messages GROUP BY 1"],
		['SELECT chat_id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at) FROM v_messages'],
		[
			"SELECT COALESCE(NULLIF(role, ''), 'unknown') FROM v_messages WHERE chat_id IN (SELECT chat_id FROM v_memories)",
		],
	])('allows common read-only syntax: %s', async (sql) => {
		const res = await validateAppDbQuery(sql, Dialect.Postgres);
		expect(res.reason).toBeUndefined();
		expect(res.ok).toBe(true);
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
