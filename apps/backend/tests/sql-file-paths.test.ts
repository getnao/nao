import { describe, expect, it } from 'vitest';

import { referencedQueryIds, rewriteStorageLiterals, storagePathsIn } from '../src/utils/sql-file-paths';

const toRealPath = (relativePath: string): string => `/var/data/users/u1/${relativePath}`;

describe('rewriteStorageLiterals', () => {
	it('rewrites a /home path to where the file really is', () => {
		const { sql } = rewriteStorageLiterals("SELECT * FROM read_csv('/home/uploads/sales.csv')", toRealPath);

		expect(sql).toBe("SELECT * FROM read_csv('/var/data/users/u1/uploads/sales.csv')");
	});

	it('reports the paths it rewrote, so the caller knows which files to make reachable', () => {
		const sql = "SELECT * FROM read_csv('/home/a.csv') JOIN read_csv('~/nested/b.csv') USING (id)";

		expect(storagePathsIn(sql)).toEqual(['a.csv', 'nested/b.csv']);
	});

	it('accepts the ~ shorthand the model reaches for', () => {
		const { sql } = rewriteStorageLiterals("SELECT * FROM read_csv('~/uploads/sales.csv')", toRealPath);

		expect(sql).toBe("SELECT * FROM read_csv('/var/data/users/u1/uploads/sales.csv')");
	});

	it('leaves every other literal alone, including one holding a quote', () => {
		const sql = "SELECT 'o''brien' AS name, '%/home/%' AS pattern FROM t WHERE country = 'FR'";

		expect(rewriteStorageLiterals(sql, () => '/rewritten')).toEqual({ sql, storagePaths: [] });
	});

	it('preserves a quote inside a rewritten path rather than breaking the literal', () => {
		const { sql } = rewriteStorageLiterals("SELECT * FROM read_csv('/home/o''brien.csv')", toRealPath);

		expect(sql).toBe("SELECT * FROM read_csv('/var/data/users/u1/o''brien.csv')");
		expect(storagePathsIn("SELECT * FROM read_csv('/home/o''brien.csv')")).toEqual(["o'brien.csv"]);
	});

	it('does not touch a project path, which DuckDB can already open', () => {
		const sql = "SELECT * FROM read_csv('/databases/duckdb/sales.csv')";

		expect(rewriteStorageLiterals(sql, toRealPath)).toEqual({ sql, storagePaths: [] });
	});

	it('refuses the storage root, which is a directory', () => {
		expect(() => rewriteStorageLiterals("SELECT * FROM read_csv('/home')", toRealPath)).toThrow(
			'is the root of your saved files',
		);
	});

	it('hands an unterminated literal to the parser untouched', () => {
		const sql = "SELECT * FROM read_csv('/home/sales.csv";

		expect(rewriteStorageLiterals(sql, toRealPath).sql).toBe(sql);
	});
});

describe('referencedQueryIds', () => {
	it('finds the query results a query joins against', () => {
		const ids = referencedQueryIds('SELECT * FROM query_ab12cd34 JOIN query_ff00ff00 USING (account_id)');

		expect(ids).toEqual(['query_ab12cd34', 'query_ff00ff00']);
	});

	it('reports each id once, however often it appears', () => {
		expect(referencedQueryIds('SELECT a.x FROM query_a1 a JOIN query_a1 b ON a.x = b.x')).toEqual(['query_a1']);
	});

	it('ignores an id inside a literal, which names a file and not a table', () => {
		expect(referencedQueryIds("SELECT * FROM read_csv('/home/exports/query_ab12cd34.csv')")).toEqual([]);
	});
});
