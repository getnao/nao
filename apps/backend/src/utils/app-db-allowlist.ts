import { Parser } from 'node-sql-parser';

import { isReadOnlySqlQuery } from './sql-filter';

export const ALLOWED_APP_DB_VIEWS = [
	'v_messages',
	'v_memories',
	'v_llm_inference',
	'v_mcp_call_log',
	'v_project',
] as const;

export interface SqlValidationResult {
	ok: boolean;
	reason?: string;
}

export async function validateAppDbQuery(sql: string): Promise<SqlValidationResult> {
	if (!(await isReadOnlySqlQuery(sql))) {
		return { ok: false, reason: 'Only read-only SELECT/WITH queries are allowed.' };
	}

	let referenced: string[];
	try {
		referenced = referencedBaseTables(sql);
	} catch {
		return { ok: false, reason: 'Could not parse the query; rejected for safety.' };
	}

	const allowed = new Set<string>(ALLOWED_APP_DB_VIEWS);
	const disallowed = [...new Set(referenced)].filter((name) => !allowed.has(name));
	if (disallowed.length > 0) {
		return {
			ok: false,
			reason: `Query references objects outside the allowlist: ${disallowed.join(', ')}. Allowed views: ${ALLOWED_APP_DB_VIEWS.join(', ')}.`,
		};
	}

	return { ok: true };
}

/** Real tables referenced by the query, excluding CTE names. Throws on parse failure. */
function referencedBaseTables(sql: string): string[] {
	const parser = new Parser();
	const opt = { database: 'sqlite' as const };
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
