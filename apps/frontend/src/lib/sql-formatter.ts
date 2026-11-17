import { format, supportedDialects } from 'sql-formatter';
import type { FormatOptionsWithLanguage } from 'sql-formatter';

// Only map where nao db name differs from sql-formatter name
const dialectMap: Record<string, string> = {
	athena: 'trino',
	databricks: 'spark',
	mssql: 'tsql',
	postgres: 'postgresql',
};

const FORMAT_OPTIONS = {
	keywordCase: 'upper',
	indentStyle: 'standard',
	tabWidth: 2,
} as const satisfies Partial<FormatOptionsWithLanguage>;

/** Dialects tried in turn when the warehouse of a query is unknown, the permissive ones first. */
const FALLBACK_DIALECTS = ['postgresql', 'duckdb', 'snowflake', 'bigquery', 'sql'] as const;

/**
 * Formats SQL with the first dialect that parses it, so that two queries written for an unknown warehouse come out
 * laid out the same way and can be compared line by line.
 */
export function formatSQLInAnyDialect(sql: string): string {
	for (const dialect of FALLBACK_DIALECTS) {
		try {
			return format(sql, { ...FORMAT_OPTIONS, language: dialect });
		} catch {
			continue;
		}
	}
	return sql;
}

export function formatSQL(sql: string, dialect: string = 'sql'): string {
	try {
		// Normalize to lowercase for case-insensitive lookup
		const normalizedDialect = dialect.toLowerCase();

		// Check map first. If not in map, use the original dialect name.
		const formatterDialect = dialectMap[normalizedDialect] || normalizedDialect;

		// Validate it's supported by sql-formatter
		const safeDialect = supportedDialects.includes(formatterDialect) ? formatterDialect : 'sql';

		return format(sql, { ...FORMAT_OPTIONS, language: safeDialect as any, linesBetweenQueries: 2 });
	} catch {
		// Fallback to original SQL if formatting fails
		return sql;
	}
}
