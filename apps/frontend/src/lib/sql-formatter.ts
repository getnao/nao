import { format, supportedDialects } from 'sql-formatter';

// Only map where nao db name differs from sql-formatter name
const dialectMap: Record<string, string> = {
	athena: 'trino',
	databricks: 'spark',
	mssql: 'tsql',
	postgres: 'postgresql',
};

export function formatSQL(sql: string, dialect: string = 'sql'): string {
	try {
		// Normalize to lowercase for case-insensitive lookup
		const normalizedDialect = dialect.toLowerCase();

		// Check map first. If not in map, use the original dialect name.
		const formatterDialect = dialectMap[normalizedDialect] || normalizedDialect;

		// Validate it's supported by sql-formatter
		const safeDialect = supportedDialects.includes(formatterDialect) ? formatterDialect : 'sql';

		return format(sql, {
			language: safeDialect as any,
			keywordCase: 'upper',
			indentStyle: 'standard',
			tabWidth: 2,
			linesBetweenQueries: 2,
		});
	} catch {
		// Fallback to original SQL if formatting fails
		return sql;
	}
}
