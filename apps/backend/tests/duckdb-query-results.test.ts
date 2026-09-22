import { describe, expect, it } from 'vitest';

import { runSqlOverQueryResults } from '../src/services/duckdb.service';
import type { QueryResult } from '../src/types/tools';

const orders: QueryResult = {
	columns: ['customer_id', 'total_amount'],
	data: [
		{ customer_id: 51, total_amount: 99.5 },
		{ customer_id: 3, total_amount: 65 },
		{ customer_id: 51, total_amount: 0.5 },
	],
};

const customers: QueryResult = {
	columns: ['id', 'name'],
	data: [
		{ id: 51, name: 'Acme' },
		{ id: 3, name: 'Globex' },
	],
};

describe('runSqlOverQueryResults', () => {
	it('exposes every query result as a table named after its query id', async () => {
		const result = await runSqlOverQueryResults(
			new Map([
				['query_orders', orders],
				['query_customers', customers],
			]),
			`SELECT c.name, SUM(o.total_amount) AS revenue
			 FROM query_orders o JOIN query_customers c ON c.id = o.customer_id
			 GROUP BY c.name ORDER BY revenue DESC`,
		);

		expect(result.columns).toEqual(['name', 'revenue']);
		expect(result.data).toEqual([
			{ name: 'Acme', revenue: 100 },
			{ name: 'Globex', revenue: 65 },
		]);
	});

	it('keeps column types so numeric aggregations work', async () => {
		const result = await runSqlOverQueryResults(
			new Map([['query_orders', orders]]),
			'SELECT COUNT(*) AS rows_count, MAX(total_amount) AS biggest FROM query_orders',
		);

		expect(result.data).toEqual([{ rows_count: 3, biggest: 99.5 }]);
	});

	it('leaves a number too large for JavaScript as text rather than rounding it', async () => {
		const result = await runSqlOverQueryResults(new Map(), 'SELECT 9223372036854775807::BIGINT AS big');

		expect(result.data).toEqual([{ big: '9223372036854775807' }]);
	});

	it('registers an empty result as an empty table', async () => {
		const result = await runSqlOverQueryResults(
			new Map([['query_empty', { columns: ['id'], data: [] }]]),
			'SELECT * FROM query_empty',
		);

		expect(result.columns).toEqual(['id']);
		expect(result.data).toEqual([]);
	});

	it('surfaces invalid SQL as an error', async () => {
		await expect(
			runSqlOverQueryResults(new Map([['query_orders', orders]]), 'SELECT missing FROM query_orders'),
		).rejects.toThrow(/missing/);
	});

	it('still exposes tables when the query id contains path separators', async () => {
		const queryId = 'query_../../escape';
		const result = await runSqlOverQueryResults(
			new Map([[queryId, orders]]),
			`SELECT COUNT(*) AS rows_count FROM "${queryId}"`,
		);

		expect(result.data).toEqual([{ rows_count: 3 }]);
	});

	it('rejects write statements before execution', async () => {
		await expect(
			runSqlOverQueryResults(new Map([['query_orders', orders]]), 'DELETE FROM query_orders'),
		).rejects.toThrow(/read-only/i);
	});

	it('rejects references to tables outside the allowlist', async () => {
		await expect(
			runSqlOverQueryResults(new Map([['query_orders', orders]]), 'SELECT * FROM query_customers'),
		).rejects.toThrow(/allowlist/i);
	});

	it('accepts DuckDB-specific syntax such as TRY_CAST', async () => {
		const result = await runSqlOverQueryResults(
			new Map([['query_orders', orders]]),
			'SELECT SUM(TRY_CAST(customer_id AS BIGINT)) AS total FROM query_orders',
		);

		expect(result.data).toEqual([{ total: 105 }]);
	});

	it('accepts DuckDB-specific syntax such as QUALIFY', async () => {
		const result = await runSqlOverQueryResults(
			new Map([['query_orders', orders]]),
			`SELECT customer_id, SUM(total_amount) AS revenue FROM query_orders GROUP BY customer_id
			 QUALIFY ROW_NUMBER() OVER (ORDER BY revenue DESC) = 1`,
		);

		expect(result.data).toEqual([{ customer_id: 51, revenue: 100 }]);
	});

	it('rejects unparseable SQL, naming DuckDB and the parser error', async () => {
		await expect(
			runSqlOverQueryResults(new Map([['query_orders', orders]]), 'SELECT FROM WHERE )('),
		).rejects.toThrow(/Could not parse the query as DuckDB.*syntax error/s);
	});

	it('allows CTEs that only read allowlisted tables', async () => {
		const result = await runSqlOverQueryResults(
			new Map([['query_orders', orders]]),
			`WITH totals AS (SELECT customer_id, SUM(total_amount) AS revenue FROM query_orders GROUP BY 1)
			 SELECT * FROM totals ORDER BY revenue DESC`,
		);

		expect(result.data).toEqual([
			{ customer_id: 51, revenue: 100 },
			{ customer_id: 3, revenue: 65 },
		]);
	});

	it('blocks reading local files after tables are loaded', async () => {
		await expect(
			runSqlOverQueryResults(new Map([['query_orders', orders]]), `SELECT * FROM read_json_auto('/etc/hosts')`),
		).rejects.toThrow();
	});
});
