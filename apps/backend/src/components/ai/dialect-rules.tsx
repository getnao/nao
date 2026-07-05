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
		sqlRules: [
			<>
				Use backtick-quoted identifiers (e.g. <Code>project.dataset.table</Code>).
			</>,
			<>
				Use <Code>SAFE_DIVIDE</Code> for division to avoid division-by-zero errors.
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
