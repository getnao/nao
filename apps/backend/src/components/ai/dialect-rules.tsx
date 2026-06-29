import type { ReactNode } from 'react';

import { Bold, ListItem } from '../../lib/markdown';

type ConnectionLike = { type: string };

/**
 * Dialect-specific guidance injected into the system prompt for the warehouses a
 * project is connected to. Every rule here is applied automatically whenever a
 * matching connection is present, so users get warehouse-aware behaviour without
 * editing their own RULES.md.
 *
 * This registry is meant to grow over time: when we observe the agent emitting SQL
 * that a given warehouse rejects, add a rule with the supported alternative.
 */
export type DialectGuidance = {
	/** Connection `type` values (lowercased) this guidance applies to. */
	matches: string[];
	/** Bold heading shown before the dialect's SQL rules, e.g. "Redshift dialect". */
	label: string;
	/** Rules added to the "SQL Query Rules" section. */
	sqlRules?: string[];
	/** Rules added to the "Tool Calls" section. */
	toolRules?: string[];
};

export const DIALECT_GUIDANCE: DialectGuidance[] = [
	{
		matches: ['clickhouse'],
		label: 'ClickHouse dialect',
		toolRules: [
			'When available, use indexes.md to see how the table is ordered and indexed (ORDER BY, PRIMARY KEY, PARTITION BY) so you can write efficient queries.',
		],
	},
	{
		matches: ['mssql', 'fabric'],
		label: 'T-SQL dialect (Fabric/MSSQL)',
		sqlRules: [
			'Use TOP N instead of LIMIT N (e.g. SELECT TOP 10 * FROM table).',
			'Do not use GROUP BY ALL — explicitly list all non-aggregated columns in the GROUP BY clause.',
			'Use T-SQL date functions (DATEADD, DATEDIFF, CONVERT, FORMAT) instead of PostgreSQL-style intervals or TO_CHAR.',
			'Use ISNULL() instead of COALESCE() when there are only two arguments.',
		],
	},
	{
		matches: ['bigquery'],
		label: 'BigQuery dialect',
		sqlRules: [
			'Use backtick-quoted identifiers (e.g. `project.dataset.table`).',
			'Use SAFE_DIVIDE for division to avoid division-by-zero errors.',
		],
	},
	{
		matches: ['mysql'],
		label: 'MySQL dialect',
		sqlRules: [
			'Use backtick-quoted identifiers for column and table names.',
			'Use IFNULL() instead of COALESCE() when there are only two arguments.',
		],
	},
	{
		matches: ['redshift'],
		label: 'Redshift dialect',
		sqlRules: [
			'Do not use SELECT DISTINCT ON (...) — it is not supported. Deduplicate with ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...) in a subquery and keep the rows where the row number equals 1.',
			'Do not put multiple PERCENTILE_CONT with different ORDER BY clauses in the same query — compute each percentile in its own CTE, then join the results.',
			'Do not combine LISTAGG(DISTINCT ...) with PERCENTILE_CONT in the same SELECT — split them into separate CTEs.',
			"Do not call CONCAT() with literal string arguments (e.g. CONCAT(first_name, ' ', last_name)). Use the || operator instead (e.g. first_name || ' ' || last_name).",
			"Do not use DATE_PART('year', AGE(date)). Use DATEDIFF('year', birthdate, CURRENT_DATE) instead.",
			'Do not use COUNT(*) FILTER (WHERE ...). Use COUNT(CASE WHEN ... THEN 1 END) instead.',
		],
	},
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
