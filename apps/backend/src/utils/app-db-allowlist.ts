import dbConfig, { Dialect } from '../db/dbConfig';
import { SqlValidationResult, validateReadOnlyAllowlistedSql } from './sql-allowlist';

export const ALLOWED_APP_DB_VIEWS = [
	'v_messages',
	'v_memories',
	'v_llm_inference',
	'v_mcp_call_log',
	'v_project',
	'v_analytics_event',
] as const;

export async function validateAppDbQuery(
	sql: string,
	dialect: Dialect = dbConfig.dialect,
): Promise<SqlValidationResult> {
	const isPostgres = dialect === Dialect.Postgres;
	return validateReadOnlyAllowlistedSql(sql, {
		allowedTables: ALLOWED_APP_DB_VIEWS,
		parserDialect: isPostgres ? 'postgresql' : 'sqlite',
		dialectName: isPostgres ? 'PostgreSQL' : 'SQLite',
	});
}
