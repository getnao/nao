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

	it('rewrites every path in a file-reader array argument', () => {
		const sql = "SELECT * FROM read_parquet(['/home/a.parquet', '/home/b.parquet'])";

		expect(rewriteStorageLiterals(sql, toRealPath)).toEqual({
			sql: "SELECT * FROM read_parquet(['/var/data/users/u1/a.parquet', '/var/data/users/u1/b.parquet'])",
			storagePaths: ['a.parquet', 'b.parquet'],
		});
	});

	it('accepts the ~ shorthand the model reaches for', () => {
		const { sql } = rewriteStorageLiterals("SELECT * FROM read_csv('~/uploads/sales.csv')", toRealPath);

		expect(sql).toBe("SELECT * FROM read_csv('/var/data/users/u1/uploads/sales.csv')");
	});

	it('leaves every other literal alone, including one holding a quote', () => {
		const sql = "SELECT 'o''brien' AS name, '%/home/%' AS pattern FROM t WHERE country = 'FR'";

		expect(rewriteStorageLiterals(sql, () => '/rewritten')).toEqual({ sql, storagePaths: [] });
	});

	it('leaves a virtual path used as an ordinary SQL value alone', () => {
		const sql = "SELECT '/home/uploads/sales.csv' AS path";

		expect(rewriteStorageLiterals(sql, () => '/private/path')).toEqual({ sql, storagePaths: [] });
	});

	it('ignores virtual paths in SQL comments', () => {
		const sql = "SELECT 1 /* read_csv('/home/missing.csv') */ -- read_csv('/home/also-missing.csv')";

		expect(rewriteStorageLiterals(sql, () => '/private/path')).toEqual({ sql, storagePaths: [] });
	});

	it('does not treat reader names in comments or values as active calls', () => {
		const comment = "SELECT 1 /* read_csv( */ , '/home/ordinary-value.csv' AS path";
		const value = "SELECT 'read_csv(' AS function_name, '/home/ordinary-value.csv' AS path";

		expect(rewriteStorageLiterals(comment, () => '/private/path')).toEqual({ sql: comment, storagePaths: [] });
		expect(rewriteStorageLiterals(value, () => '/private/path')).toEqual({ sql: value, storagePaths: [] });
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

	it('ignores ids inside SQL comments', () => {
		expect(
			referencedQueryIds('SELECT * FROM query_real -- JOIN query_not_real\n/* query_also_not_real */'),
		).toEqual(['query_real']);
	});
});
