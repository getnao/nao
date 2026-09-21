import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getConnections } from '../src/agents/user-rules';
import { SystemPrompt } from '../src/components/ai/system-prompt';
import { renderToMarkdown } from '../src/lib/markdown';

function renderWith(connections: { type: string; database: string }[]): string {
	return renderToMarkdown(SystemPrompt({ connections }));
}

function sqlQueryRulesSection(markdown: string): string {
	const start = markdown.indexOf('## SQL Query Rules');
	const end = markdown.indexOf('## Citations Rules');
	return markdown.slice(start, end);
}

describe('dialect-aware system prompt', () => {
	it('omits dialect rules when no matching connection is present', () => {
		const markdown = renderWith([{ type: 'duckdb', database: 'analytics' }]);
		expect(markdown).not.toContain('dialect:');
		expect(markdown).not.toContain('SELECT DISTINCT ON');
	});

	it('injects Redshift dialect rules when a redshift connection is present', () => {
		const section = sqlQueryRulesSection(renderWith([{ type: 'redshift', database: 'analytics' }]));

		expect(section).toContain('**Redshift dialect:** Do not use `SELECT DISTINCT ON (...)`');
		expect(section).toContain('`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`');
		expect(section).toContain('compute each percentile in its own CTE');
		expect(section).toContain('`LISTAGG(DISTINCT ...)` with `PERCENTILE_CONT`');
		expect(section).toContain('Use the `||` operator instead');
		expect(section).toContain("`DATEDIFF('year', birthdate, CURRENT_DATE)`");
		expect(section).toContain('`COUNT(CASE WHEN ... THEN 1 END)`');
	});

	it('matches dialects case-insensitively', () => {
		const section = sqlQueryRulesSection(renderWith([{ type: 'RedShift', database: 'analytics' }]));
		expect(section).toContain('**Redshift dialect:**');
	});

	it('renders each dialect rule as its own bullet', () => {
		const section = sqlQueryRulesSection(renderWith([{ type: 'redshift', database: 'analytics' }]));
		const redshiftBullets = section
			.split('\n')
			.filter((line) => line.startsWith('- ') && (line.includes('Redshift dialect') || line.includes('Do not')));
		expect(redshiftBullets.length).toBe(6);
	});

	it('keeps existing dialect guidance for T-SQL, BigQuery and MySQL', () => {
		const tsql = sqlQueryRulesSection(renderWith([{ type: 'mssql', database: 'db' }]));
		expect(tsql).toContain('**T-SQL dialect (Fabric/MSSQL):** Use `TOP N` instead of `LIMIT N`');

		const fabric = sqlQueryRulesSection(renderWith([{ type: 'fabric', database: 'db' }]));
		expect(fabric).toContain('**T-SQL dialect (Fabric/MSSQL):** Use `TOP N` instead of `LIMIT N`');

		const bigquery = sqlQueryRulesSection(renderWith([{ type: 'bigquery', database: 'db' }]));
		expect(bigquery).toContain('**BigQuery dialect:** Use backtick-quoted identifiers');

		const mysql = sqlQueryRulesSection(renderWith([{ type: 'mysql', database: 'db' }]));
		expect(mysql).toContain('**MySQL dialect:** Use backtick-quoted identifiers');
	});

	it('injects the ClickHouse tool-call rule under Tool Calls', () => {
		const markdown = renderWith([{ type: 'clickhouse', database: 'events' }]);
		const toolCalls = markdown.slice(markdown.indexOf('## Tool Calls'), markdown.indexOf('## SQL Query Rules'));
		expect(toolCalls).toContain('use `indexes.md` to see how the table is ordered and indexed');
	});
});

describe('dialect rules end-to-end from a synced project folder', () => {
	let projectFolder: string;

	beforeEach(() => {
		projectFolder = mkdtempSync(join(tmpdir(), 'nao-dialect-'));
		mkdirSync(join(projectFolder, 'databases', 'type=redshift', 'database=analytics'), { recursive: true });
	});

	afterEach(() => {
		rmSync(projectFolder, { recursive: true, force: true });
	});

	it('discovers a redshift connection and injects its dialect rules', () => {
		const connections = getConnections(projectFolder);
		expect(connections).toEqual([{ type: 'redshift', database: 'analytics' }]);

		const markdown = renderToMarkdown(SystemPrompt({ connections }));
		expect(markdown).toContain('**Redshift dialect:** Do not use `SELECT DISTINCT ON (...)`');
		expect(markdown).toContain('`COUNT(CASE WHEN ... THEN 1 END)`');
	});
});
