import { Parser } from 'node-sql-parser';

import { isReadOnlySqlQuery } from './sql-filter';

export interface SqlValidationResult {
	ok: boolean;
	reason?: string;
}

export interface SqlAllowlistOptions {
	allowedTables: readonly string[];
	parserDialect: 'postgresql' | 'sqlite';
	dialectName: string;
}

/**
 * Validates untrusted SQL against a read-only, table-allowlisted policy:
 * only SELECT/WITH statements that reference the allowed tables pass.
 */
export async function validateReadOnlyAllowlistedSql(
	sql: string,
	{ allowedTables, parserDialect, dialectName }: SqlAllowlistOptions,
): Promise<SqlValidationResult> {
	if (!(await isReadOnlySqlQuery(sql))) {
		return { ok: false, reason: 'Only read-only SELECT/WITH queries are allowed.' };
	}

	let referenced: string[];
	try {
		referenced = referencedBaseTables(sql, parserDialect);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			reason: `Could not parse the query as ${dialectName}; rejected for safety. Rewrite it in ${dialectName} syntax. ${detail}`,
		};
	}

	const allowed = new Set(allowedTables);
	const disallowed = [...new Set(referenced)].filter((name) => !allowed.has(name));
	if (disallowed.length > 0) {
		return {
			ok: false,
			reason: `Query references objects outside the allowlist: ${disallowed.join(', ')}. Allowed: ${allowedTables.join(', ') || '(none)'}.`,
		};
	}

	return { ok: true };
}

function referencedBaseTables(sql: string, parserDialect: 'postgresql' | 'sqlite'): string[] {
	const parser = new Parser();
	const opt = { database: parserDialect };
	// tableList entries look like "select::null::v_chat".
	const tables = parser.tableList(sql, opt).map((entry) => entry.split('::').pop() as string);
	const cteNames = collectCteNames(parser.astify(sql, opt));
	return tables.filter((name) => !cteNames.has(name));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectCteNames(ast: any): Set<string> {
	const names = new Set<string>();
	const statements = Array.isArray(ast) ? ast : [ast];
	for (const stmt of statements) {
		const withClause = stmt?.with;
		if (Array.isArray(withClause)) {
			for (const cte of withClause) {
				const name = cte?.name?.value ?? cte?.name;
				if (typeof name === 'string') {
					names.add(name);
				}
			}
		}
	}
	return names;
}
