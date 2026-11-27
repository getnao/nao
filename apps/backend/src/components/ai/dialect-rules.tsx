import type { ReactNode } from 'react';

import { Bold, Code, ListItem } from '../../lib/markdown';

type ConnectionLike = { type: string };

/**
 * Dialect-specific guidance injected into the system prompt for the warehouses a
 * project is connected to. Every rule here is applied automatically whenever a
 * matching connection is present, so users get warehouse-aware behaviour without
 * editing their own RULES.md.
 *
 * This registry is meant to grow over time: when we observe the agent emitting SQL
 * that a given warehouse rejects, add a rule with the supported alternative. Rules
 * are authored with the same markdown components as the system prompt, so SQL can
 * be wrapped in <Code> and emphasised with <Bold>.
 */
export type DialectGuidance = {
	/** Connection `type` values (lowercased) this guidance applies to. */
	matches: string[];
	/** Bold heading shown before the dialect's SQL rules, e.g. "Redshift dialect". */
	label: string;
	/** Rules added to the "SQL Query Rules" section, one bullet per entry. */
	sqlRules?: ReactNode[];
	/** Rules added to the "Tool Calls" section, one bullet per entry. */
	toolRules?: ReactNode[];
};

export const DIALECT_GUIDANCE: DialectGuidance[] = [
	{
		matches: ['clickhouse'],
		label: 'ClickHouse dialect',
		toolRules: [
			<>
				When available, use <Code>indexes.md</Code> to see how the table is ordered and indexed (
				<Code>ORDER BY</Code>, <Code>PRIMARY KEY</Code>, <Code>PARTITION BY</Code>) so you can write efficient
				queries.
			</>,
		],
	},
	{
		matches: ['mssql', 'fabric'],
		label: 'T-SQL dialect (Fabric/MSSQL)',
		sqlRules: [
			<>
				Use <Code>TOP N</Code> instead of <Code>LIMIT N</Code> (e.g. <Code>SELECT TOP 10 * FROM table</Code>).
			</>,
			<>
				Do not use <Code>GROUP BY ALL</Code> — explicitly list all non-aggregated columns in the{' '}
				<Code>GROUP BY</Code> clause.
			</>,
			<>
				Use T-SQL date functions (<Code>DATEADD</Code>, <Code>DATEDIFF</Code>, <Code>CONVERT</Code>,{' '}
				<Code>FORMAT</Code>) instead of PostgreSQL-style intervals or <Code>TO_CHAR</Code>.
			</>,
			<>
				Use <Code>ISNULL()</Code> instead of <Code>COALESCE()</Code> when there are only two arguments.
			</>,
		],
	},
	{
		matches: ['bigquery'],
		label: 'BigQuery dialect',
		toolRules: [
			<>
				When BigQuery rejects a query because an uploaded-file filter exceeds its parameter or query-size limit,
				tell the user briefly and retry locally. Re-run the warehouse query without the file-derived{' '}
				<Code>IN</Code> filter, retaining selective predicates and returning the join key and required columns.
				Then use <Code>execute_sql</Code> with <Code>database_id: duckdb_local</Code> to join the result to the
				uploaded file and finish filtering or aggregation. Preserve the original <Code>IN</Code> semantics: use{' '}
				<Code>EXISTS</Code>/<Code>SEMI JOIN</Code>, or join against distinct file keys, so repeated values do
				not multiply warehouse rows. Do not use <Code>LIMIT</Code> to make the result fit. If it would be too
				large, explain that the file must be narrowed or staged in BigQuery.
			</>,
		],
		sqlRules: [
			<>
				Use backtick-quoted identifiers (e.g. <Code>project.dataset.table</Code>).
			</>,
			<>
				Use <Code>SAFE_DIVIDE</Code> for division to avoid division-by-zero errors.
			</>,
			<>
				In a <Code>GROUP BY</Code> query, every column referenced inside a window <Code>ORDER BY</Code>/
				<Code>PARTITION BY</Code> must be in the <Code>GROUP BY</Code> or wrapped in an aggregate. Wrong:{' '}
				<Code>SUM(SUM(x)) OVER (ORDER BY DATE_TRUNC(DATE(created_at), MONTH))</Code>. Right: group by the month
				first, e.g. <Code>SUM(SUM(x)) OVER (ORDER BY month)</Code>.
			</>,
			<>
				Do not use the inline <Code>VALUES</Code> table constructor (<Code>FROM (VALUES (...)) AS t(...)</Code>)
				— it is not supported. Build literal rows with <Code>SELECT ... UNION ALL SELECT ...</Code> or{' '}
				<Code>UNNEST([STRUCT(...), STRUCT(...)])</Code>.
			</>,
			<>
				Do not use <Code>IGNORE NULLS</Code>/<Code>RESPECT NULLS</Code> with <Code>STRING_AGG</Code> — they are
				not supported on that function.
			</>,
			<>
				Use <Code>LOGICAL_OR()</Code>/<Code>LOGICAL_AND()</Code> instead of the Postgres/DuckDB{' '}
				<Code>BOOL_OR()</Code>/<Code>BOOL_AND()</Code>. An <Code>ORDER BY</Code> that references a column not in
				the <Code>GROUP BY</Code> and not aggregated raises a 400 error.
			</>,
			<>
				Do not use <Code>ILIKE</Code> — it is not supported. For case-insensitive matching use{' '}
				<Code>LOWER(col) LIKE LOWER('%pattern%')</Code> or <Code>REGEXP_CONTAINS(col, r'(?i)pattern')</Code>.
			</>,
			<>
				<Code>GROUP BY ALL</Code> is supported — prefer it over listing every non-aggregated column.
			</>,
			<>
				<Code>TIMESTAMP</Code>, <Code>DATETIME</Code> and <Code>DATE</Code> are distinct types, and comparing a{' '}
				<Code>TIMESTAMP</Code> to a <Code>DATE</Code> or <Code>DATETIME</Code> fails: check the column type
				first and match it. Wrong: <Code>ts_col &gt;= CURRENT_DATE()</Code>. Right:{' '}
				<Code>ts_col &gt;= TIMESTAMP('2024-01-01')</Code> or <Code>DATE(ts_col) &gt;= CURRENT_DATE()</Code>. Use
				the function family of the column type (<Code>TIMESTAMP_TRUNC</Code>/<Code>TIMESTAMP_DIFF</Code>,{' '}
				<Code>DATETIME_TRUNC</Code>/<Code>DATETIME_DIFF</Code>, <Code>DATE_TRUNC</Code>/<Code>DATE_DIFF</Code>).
			</>,
			<>
				<Code>TIMESTAMP_ADD</Code>/<Code>TIMESTAMP_SUB</Code> only accept intervals up to <Code>DAY</Code>. For{' '}
				<Code>WEEK</Code>, <Code>MONTH</Code>, <Code>QUARTER</Code> or <Code>YEAR</Code>, work on dates, e.g.{' '}
				<Code>DATE(ts_col) &gt;= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)</Code>.
			</>,
			<>
				Do not use Postgres-style date syntax: use <Code>CURRENT_TIMESTAMP()</Code> instead of{' '}
				<Code>NOW()</Code>, <Code>INTERVAL 30 DAY</Code> instead of <Code>INTERVAL '30 days'</Code>,{' '}
				<Code>CAST(x AS TIMESTAMP)</Code> instead of <Code>x::timestamp</Code>,{' '}
				<Code>DATE_TRUNC(col, MONTH)</Code> instead of <Code>DATE_TRUNC('month', col)</Code>, and{' '}
				<Code>UNIX_SECONDS(ts_col)</Code> instead of <Code>EXTRACT(EPOCH FROM ts_col)</Code>.
			</>,
		],
	},
	{
		matches: ['snowflake'],
		label: 'Snowflake dialect',
		sqlRules: [
			<>
				Use <Code>DATEDIFF(day, start, end)</Code> and <Code>DATEADD(day, n, date)</Code>. There is no{' '}
				<Code>DATE_DIFF</Code>, <Code>TIMESTAMP_DIFF</Code> or <Code>SAFE_DIVIDE</Code>: divide with{' '}
				<Code>DIV0(a, b)</Code> or <Code>a / NULLIF(b, 0)</Code>, and raise to a power with{' '}
				<Code>POWER(x, n)</Code>, not <Code>^</Code>.
			</>,
			<>
				Aggregate booleans with <Code>BOOLOR_AGG(col)</Code>/<Code>BOOLAND_AGG(col)</Code>, not{' '}
				<Code>BOOL_OR</Code>/<Code>LOGICAL_OR</Code>. <Code>BOOLOR(a, b)</Code> and <Code>BOOLAND(a, b)</Code>{' '}
				are not aggregates and take two arguments.
			</>,
			<>
				In a <Code>GROUP BY</Code> query, every expression in <Code>SELECT</Code>, <Code>ORDER BY</Code> or a{' '}
				<Code>CASE</Code> must be grouped or aggregated. Prefer <Code>GROUP BY ALL</Code>, and order by a
				selected alias.
			</>,
			<>
				A window function cannot sit inside an aggregate, and aggregates cannot be nested: compute the window or
				the first aggregate in a CTE, then aggregate its result. <Code>QUALIFY</Code> only filters on a window
				function of the query (in <Code>SELECT</Code> or in its condition); without one, use <Code>WHERE</Code>{' '}
				or <Code>HAVING</Code>.
			</>,
			<>
				Correlated subqueries are rarely supported (<Code>Unsupported subquery type</Code>): rewrite them as a
				CTE joined on the correlation keys.
			</>,
			<>
				Comparing a text column holding values like <Code>'GP-123'</Code> to a number fails: compare it as text,
				or use <Code>TRY_TO_NUMBER(col)</Code>.
			</>,
		],
	},
	{
		matches: ['mysql'],
		label: 'MySQL dialect',
		sqlRules: [
			<>Use backtick-quoted identifiers for column and table names.</>,
			<>
				Use <Code>IFNULL()</Code> instead of <Code>COALESCE()</Code> when there are only two arguments.
			</>,
		],
	},
	{
		matches: ['redshift'],
		label: 'Redshift dialect',
		sqlRules: [
			<>
				Do not use <Code>SELECT DISTINCT ON (...)</Code> — it is not supported. Deduplicate with{' '}
				<Code>ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)</Code> in a subquery and keep the rows where the
				row number equals 1.
			</>,
			<>
				Do not put multiple <Code>PERCENTILE_CONT</Code> with different <Code>ORDER BY</Code> clauses in the
				same query — compute each percentile in its own CTE, then join the results.
			</>,
			<>
				Do not combine <Code>LISTAGG(DISTINCT ...)</Code> with <Code>PERCENTILE_CONT</Code> in the same{' '}
				<Code>SELECT</Code> — split them into separate CTEs.
			</>,
			<>
				Do not call <Code>CONCAT()</Code> with literal string arguments (e.g.{' '}
				<Code>CONCAT(first_name, ' ', last_name)</Code>). Use the <Code>||</Code> operator instead (e.g.{' '}
				<Code>first_name || ' ' || last_name</Code>).
			</>,
			<>
				Do not use <Code>DATE_PART('year', AGE(date))</Code>. Use{' '}
				<Code>DATEDIFF('year', birthdate, CURRENT_DATE)</Code> instead.
			</>,
			<>
				Do not use <Code>COUNT(*) FILTER (WHERE ...)</Code>. Use <Code>COUNT(CASE WHEN ... THEN 1 END)</Code>{' '}
				instead.
			</>,
		],
	},
];

/** Rules for nao's own DuckDB (`duckdb_local`), where agents keep writing the dialect of the project's warehouse. */
export const LOCAL_DUCKDB_SQL_RULES: ReactNode[] = [
	<>
		Warehouse functions do not exist here. Use <Code>a / NULLIF(b, 0)</Code> instead of <Code>SAFE_DIVIDE</Code>,{' '}
		<Code>regexp_matches(col, pattern)</Code> instead of <Code>REGEXP_CONTAINS</Code>, and{' '}
		<Code>date_diff('day', start, end)</Code> with the unit first.
	</>,
	<>
		Warehouse tables are not here: <Code>database.schema.table</Code> fails with{' '}
		<Code>Catalog … does not exist</Code>. Warehouse data only reaches this database as an earlier result, read by
		its query id. Those <Code>query_…</Code> tables exist only here, never in the warehouse.
	</>,
	<>
		Every selected column that is not aggregated must be in the <Code>GROUP BY</Code>; prefer{' '}
		<Code>GROUP BY ALL</Code>. Every branch of a <Code>UNION</Code> returns the same number of columns.
	</>,
	<>
		Columns read from CSV or from a result can be text: cast before comparing or calling date functions, e.g.{' '}
		<Code>month(col::DATE)</Code> or <Code>col::TIMESTAMP &gt;= TIMESTAMP '2026-01-01'</Code>.
	</>,
];

export function getDialectSqlQueryRules(connections: ConnectionLike[]): ReactNode[] {
	return getActiveDialectGuidance(connections).flatMap(toSqlRuleItems);
}

export function getDialectToolCallRules(connections: ConnectionLike[]): ReactNode[] {
	return getActiveDialectGuidance(connections).flatMap(toToolRuleItems);
}

function getActiveDialectGuidance(connections: ConnectionLike[]): DialectGuidance[] {
	const presentTypes = new Set(connections.map((connection) => connection.type.toLowerCase()));
	return DIALECT_GUIDANCE.filter((guidance) => guidance.matches.some((match) => presentTypes.has(match)));
}

function toSqlRuleItems(guidance: DialectGuidance): ReactNode[] {
	return (guidance.sqlRules ?? []).map((rule, index) =>
		index === 0 ? (
			<ListItem>
				<Bold>{guidance.label}:</Bold> {rule}
			</ListItem>
		) : (
			<ListItem>{rule}</ListItem>
		),
	);
}

function toToolRuleItems(guidance: DialectGuidance): ReactNode[] {
	return (guidance.toolRules ?? []).map((rule) => <ListItem>{rule}</ListItem>);
}
