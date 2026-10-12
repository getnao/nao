import { AST, Option, Parser } from 'node-sql-parser';

import { isReadOnlySqlQuery } from './sql-filter';
import { listSqlFunctionCalls } from './sql-function-calls';

export interface SqlValidationResult {
	ok: boolean;
	reason?: string;
}

export interface SqlAllowlistOptions {
	allowedTables: readonly string[];
	allowedFunctions?: readonly string[];
	parserDialect: 'postgresql' | 'sqlite';
	dialectName: string;
}

/**
 * Validates untrusted SQL against a read-only, table-allowlisted policy:
 * only SELECT/WITH statements that reference the allowed tables (and, when given, call only the allowed functions) pass.
 */
export async function validateReadOnlyAllowlistedSql(
	sql: string,
	{ allowedTables, allowedFunctions, parserDialect, dialectName }: SqlAllowlistOptions,
): Promise<SqlValidationResult> {
	if (!(await isReadOnlySqlQuery(sql))) {
		return { ok: false, reason: 'Only read-only SELECT/WITH queries are allowed.' };
	}

	let parsed: ParsedQuery;
	try {
		parsed = parseQuery(sql, parserDialect);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			reason: `Could not parse the query as ${dialectName}; rejected for safety. Rewrite it in ${dialectName} syntax. ${detail}`,
		};
	}

	if (parsed.statementCount !== 1) {
		return { ok: false, reason: 'Only a single SELECT/WITH statement is allowed.' };
	}

	const allowed = new Set(allowedTables);
	const disallowed = [...new Set(parsed.referencedTables)].filter((name) => !allowed.has(name));
	if (disallowed.length > 0) {
		return {
			ok: false,
			reason: `Query references objects outside the allowlist: ${disallowed.join(', ')}. Allowed: ${allowedTables.join(', ') || '(none)'}.`,
		};
	}

	if (allowedFunctions) {
		const disallowedFunctions = findDisallowedFunctions(sql, new Set(allowedFunctions));
		if (!disallowedFunctions) {
			return {
				ok: false,
				reason: 'Prefixed (E/U&/B/X) or dollar-quoted literals are not supported; use plain quoted strings.',
			};
		}
		if (disallowedFunctions.length > 0) {
			return {
				ok: false,
				reason: `Query calls functions outside the allowlist: ${disallowedFunctions.join(', ')}. Use standard aggregate, window, date, string, math and JSON functions.`,
			};
		}
	}

	return { ok: true };
}

interface ParsedQuery {
	statementCount: number;
	referencedTables: string[];
}

interface TableReference {
	schema: string | null;
	table: string;
}

interface CteNode {
	name?: { value?: string } | string;
	stmt?: { ast?: unknown };
	recursive?: boolean;
}

function parseQuery(sql: string, parserDialect: 'postgresql' | 'sqlite'): ParsedQuery {
	const parser = new Parser();
	const options: Option = { database: parserDialect };
	const ast = parser.astify(sql, options);
	const statements = Array.isArray(ast) ? ast : [ast];
	const cteNames =
		statements.length === 1 ? collectInScopeCteNames(parser, statements[0], options) : new Set<string>();
	const referencedTables = listTableReferences(parser, sql, options)
		.filter((reference) => reference.schema !== null || !cteNames.has(reference.table))
		.map(formatTableReference);
	return { statementCount: statements.length, referencedTables };
}

/**
 * Function calls are the one way a SELECT reaches beyond the tables it names: `query_to_xml`,
 * `table_to_xml` or `ts_stat` run SQL text with the connection's privileges. Only known functions pass.
 * Postgres resolves `name(` as a function even when a CTE has that name, so only the syntactic
 * positions where `name(` is not a call (alias and CTE column lists) are exempt.
 */
function findDisallowedFunctions(sql: string, allowedFunctions: ReadonlySet<string>) {
	const calls = listSqlFunctionCalls(sql);
	if (!calls) {
		return null;
	}
	const disallowed = calls.filter((call) => {
		if (call.isQualified) {
			return true;
		}
		if (call.isAfterAs || call.isCteDeclaration) {
			return false;
		}
		const name = call.isQuoted ? call.name : call.name.toLowerCase();
		return !allowedFunctions.has(name) && (call.isQuoted || !KEYWORDS_BEFORE_PARENTHESIS.has(name));
	});
	return [...new Set(disallowed.map((call) => call.name))];
}

const KEYWORDS_BEFORE_PARENTHESIS = new Set([
	'all',
	'and',
	'any',
	'array',
	'as',
	'between',
	'by',
	'case',
	'cast',
	'cube',
	'distinct',
	'else',
	'except',
	'exists',
	'extract',
	'filter',
	'from',
	'group',
	'grouping',
	'having',
	'ilike',
	'in',
	'intersect',
	'is',
	'join',
	'lateral',
	'like',
	'not',
	'on',
	'or',
	'over',
	'rollup',
	'row',
	'select',
	'sets',
	'some',
	'then',
	'to',
	'union',
	'using',
	'values',
	'when',
	'where',
	'with',
]);

/**
 * Top-level CTE names that every unqualified reference in the statement resolves to. Without RECURSIVE,
 * a CTE is not visible in its own body nor in the bodies of earlier CTEs: the same name there resolves
 * to a real relation, so it must stay subject to the allowlist.
 */
function collectInScopeCteNames(parser: Parser, statement: AST, options: Option): Set<string> {
	const withClause = (statement as { with?: unknown }).with;
	const ctes: CteNode[] = Array.isArray(withClause) ? withClause : [];
	const isRecursive = ctes.some((cte) => cte.recursive === true);
	const names = new Set<string>();
	ctes.forEach((cte, index) => {
		const name = getCteName(cte);
		if (!name) {
			return;
		}
		const visibleCtes = ctes.slice(0, index + 1);
		if (isRecursive || !visibleCtes.some((body) => isReferencedInCteBody(parser, body, name, options))) {
			names.add(name);
		}
	});
	return names;
}

function isReferencedInCteBody(parser: Parser, cte: CteNode, name: string, options: Option): boolean {
	const body = parser.sqlify((cte.stmt?.ast ?? cte.stmt) as AST, options);
	return listTableReferences(parser, body, options).some(
		(reference) => reference.schema === null && reference.table === name,
	);
}

/** Parses tableList entries such as "select::null::v_chat" or "select::public::user". */
function listTableReferences(parser: Parser, sql: string, options: Option): TableReference[] {
	return parser.tableList(sql, options).map((entry) => {
		const [, schema, table] = entry.split('::');
		return { schema: schema === 'null' ? null : schema, table };
	});
}

function formatTableReference({ schema, table }: TableReference): string {
	return schema ? `${schema}.${table}` : table;
}

function getCteName(cte: CteNode): string | undefined {
	const name = typeof cte.name === 'string' ? cte.name : cte.name?.value;
	return typeof name === 'string' ? name : undefined;
}
