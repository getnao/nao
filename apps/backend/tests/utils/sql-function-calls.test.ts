import { describe, expect, it } from 'vitest';

import { listSqlFunctionCalls } from '../../src/utils/sql-function-calls';

describe('listSqlFunctionCalls', () => {
	it.each([
		'WITH t(a, b) AS (SELECT 1, 2) SELECT a FROM t',
		'WITH t("a") AS NOT MATERIALIZED (VALUES (1)) SELECT a FROM t',
		'WITH t(a) AS ((SELECT 1)) SELECT a FROM t',
	])('marks a CTE declared with a column list as a declaration: %s', (sql) => {
		const declaration = listSqlFunctionCalls(sql)?.find((call) => call.name === 't');
		expect(declaration?.isCteDeclaration).toBe(true);
	});

	it.each([
		'SELECT * FROM dblink(name) AS (x text)',
		"SELECT query_to_xml('select 1', true, true, '') AS x",
		'SELECT * FROM t(a, b)',
	])('keeps a real call that only resembles a declaration: %s', (sql) => {
		const calls = listSqlFunctionCalls(sql) ?? [];
		expect(calls.some((call) => call.isCteDeclaration)).toBe(false);
	});

	it('reads through nested block comments', () => {
		const calls = listSqlFunctionCalls('SELECT pg_sleep/* outer /* inner */ tail */(1)');
		expect(calls?.map((call) => call.name)).toEqual(['pg_sleep']);
	});

	it('fails closed on an unterminated nested comment', () => {
		expect(listSqlFunctionCalls('SELECT 1 /* outer /* inner */')).toBeNull();
	});
});
