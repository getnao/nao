const WRITE_STATEMENT_RE =
	/^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE|RENAME|CALL|EXEC|EXECUTE|LOCK|UNLOCK)\b/i;
const SELECT_RE = /^\s*SELECT\b/i;
const WITH_RE = /^\s*WITH\b/i;

export async function isReadOnlySqlQuery(sql: string): Promise<boolean> {
	const cleaned = stripComments(sql);
	const statements = splitStatements(cleaned);
	if (statements.length === 0) {
		return false;
	}
	return statements.every(isStatementReadOnly);
}

function isStatementReadOnly(statement: string): boolean {
	const trimmed = statement.trim();
	if (!trimmed) {
		return true;
	}
	if (WRITE_STATEMENT_RE.test(trimmed)) {
		return false;
	}
	if (SELECT_RE.test(trimmed)) {
		return true;
	}
	if (WITH_RE.test(trimmed)) {
		const mainKeyword = getWithMainKeyword(trimmed);
		return mainKeyword === 'SELECT';
	}
	return false;
}

/**
 * Detect a row-count limit applied by the outermost query (`LIMIT`, `TOP`,
 * or `FETCH FIRST ... ROWS`). Returns the maximum number of rows the query is
 * allowed to return, or `null` when no top-level limit is present.
 *
 * This is a heuristic used to warn the model that a result set may be truncated
 * by its own SQL — it deliberately ignores limits inside subqueries/CTEs.
 */
export function detectQueryRowLimit(sql: string): number | null {
	const masked = maskQuotedStrings(stripComments(sql));
	const topLevel = extractTopLevelSql(masked);

	const limitOffsetComma = /\bLIMIT\s+\d+\s*,\s*(\d+)/i.exec(topLevel);
	if (limitOffsetComma) {
		return Number.parseInt(limitOffsetComma[1], 10);
	}

	const limit = /\bLIMIT\s+(\d+)/i.exec(topLevel);
	if (limit) {
		return Number.parseInt(limit[1], 10);
	}

	const fetchFirst = /\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\b/i.exec(topLevel);
	if (fetchFirst) {
		return Number.parseInt(fetchFirst[1], 10);
	}

	// TOP keeps its row count inside its own parentheses (TOP (20)), so detect it
	// against the paren-preserving masked SQL. The `row_count >= applied_limit`
	// guard at render time prevents false warnings from limits in subqueries.
	const top = /\bTOP\s*\(?\s*(\d+)\s*\)?\s*(PERCENT)?/i.exec(masked);
	if (top && !top[2]) {
		return Number.parseInt(top[1], 10);
	}

	return null;
}

/** Replace the contents of string literals (and their quotes) with spaces. */
function maskQuotedStrings(sql: string): string {
	let result = '';
	let quote: string | null = null;

	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];

		if (quote) {
			if (ch === quote && sql[i - 1] !== '\\') {
				quote = null;
			}
			result += ' ';
			continue;
		}

		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			result += ' ';
		} else {
			result += ch;
		}
	}

	return result;
}

/**
 * Replace everything inside parentheses with spaces so limit detection only
 * sees clauses that belong to the outermost query. Expects string literals to
 * already be masked.
 */
function extractTopLevelSql(sql: string): string {
	let result = '';
	let depth = 0;

	for (const ch of sql) {
		if (ch === '(') {
			depth++;
			result += ' ';
		} else if (ch === ')') {
			if (depth > 0) {
				depth--;
			}
			result += ' ';
		} else {
			result += depth === 0 ? ch : ' ';
		}
	}

	return result;
}

function stripComments(sql: string): string {
	return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Split SQL on semicolons, respecting quoted strings.
 */
function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = '';
	let quote: string | null = null;

	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];

		if (quote) {
			current += ch;
			if (ch === quote && sql[i - 1] !== '\\') {
				quote = null;
			}
			continue;
		}

		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			current += ch;
		} else if (ch === ';') {
			statements.push(current);
			current = '';
		} else {
			current += ch;
		}
	}

	if (current.trim()) {
		statements.push(current);
	}
	return statements;
}

/**
 * For `WITH ... AS (...) <operation>` statements, skip past all CTE
 * definitions (balanced parentheses) and return the main operation keyword.
 */
function getWithMainKeyword(sql: string): string | null {
	let pos = sql.search(/\bWITH\b/i);
	if (pos === -1) {
		return null;
	}
	pos += 4;

	const afterWith = sql.slice(pos).trimStart();
	if (/^RECURSIVE\b/i.test(afterWith)) {
		pos = sql.indexOf(afterWith) + 9;
	}

	let depth = 0;
	let quote: string | null = null;

	while (pos < sql.length) {
		const ch = sql[pos];

		if (quote) {
			if (ch === quote && sql[pos - 1] !== '\\') {
				quote = null;
			}
			pos++;
			continue;
		}

		if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				const rest = sql.slice(pos + 1).trimStart();
				if (rest.startsWith(',')) {
					pos = sql.indexOf(',', pos + 1) + 1;
					continue;
				}
				const match = rest.match(/^(\w+)/);
				return match ? match[1].toUpperCase() : null;
			}
		}
		pos++;
	}

	return null;
}
