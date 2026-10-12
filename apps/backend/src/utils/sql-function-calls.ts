export interface SqlFunctionCall {
	name: string;
	isQuoted: boolean;
	isQualified: boolean;
	isAfterAs: boolean;
}

interface Token {
	kind: 'word' | 'quoted' | 'string' | 'number' | 'punct';
	value: string;
}

/**
 * Lists every `name(` in a PostgreSQL query: function calls, but also keywords and type names
 * followed by a parenthesis. Returns null for syntax this lexer does not model exactly
 * (prefixed or dollar-quoted strings, unterminated literals), so callers can fail closed.
 */
export function listSqlFunctionCalls(sql: string): SqlFunctionCall[] | null {
	const tokens = tokenize(sql);
	if (!tokens) {
		return null;
	}

	const calls: SqlFunctionCall[] = [];
	tokens.forEach((token, index) => {
		const name = tokens[index - 1];
		if (token.value !== '(' || !name || (name.kind !== 'word' && name.kind !== 'quoted')) {
			return;
		}
		const before = tokens[index - 2];
		calls.push({
			name: name.value,
			isQuoted: name.kind === 'quoted',
			isQualified: before?.value === '.',
			isAfterAs: before?.kind === 'word' && before.value.toLowerCase() === 'as',
		});
	});
	return calls;
}

function tokenize(sql: string): Token[] | null {
	const tokens: Token[] = [];
	let index = 0;
	while (index < sql.length) {
		const char = sql[index];
		const next = sql[index + 1];

		if (/\s/.test(char)) {
			index++;
		} else if (char === '-' && next === '-') {
			const end = sql.indexOf('\n', index);
			index = end === -1 ? sql.length : end + 1;
		} else if (char === '/' && next === '*') {
			const end = sql.indexOf('*/', index + 2);
			if (end === -1) {
				return null;
			}
			index = end + 2;
		} else if (char === "'" || char === '"') {
			if (index > 0 && isPrefixCharacter(sql[index - 1])) {
				return null;
			}
			const end = findClosingQuote(sql, index, char);
			if (end === -1) {
				return null;
			}
			const kind = char === "'" ? 'string' : 'quoted';
			tokens.push({ kind, value: sql.slice(index + 1, end).replaceAll(char + char, char) });
			index = end + 1;
		} else if (char === '$') {
			return null;
		} else if (isWordStart(char)) {
			const end = scanWhile(sql, index, isWordCharacter);
			tokens.push({ kind: 'word', value: sql.slice(index, end) });
			index = end;
		} else if (/[0-9]/.test(char)) {
			const end = scanWhile(sql, index, (c) => /[0-9A-Za-z_.]/.test(c));
			tokens.push({ kind: 'number', value: sql.slice(index, end) });
			index = end;
		} else {
			tokens.push({ kind: 'punct', value: char });
			index++;
		}
	}
	return tokens;
}

function findClosingQuote(sql: string, openIndex: number, quote: string): number {
	let index = openIndex + 1;
	while (index < sql.length) {
		if (sql[index] === quote) {
			if (sql[index + 1] !== quote) {
				return index;
			}
			index += 2;
		} else {
			index++;
		}
	}
	return -1;
}

function scanWhile(sql: string, start: number, predicate: (char: string) => boolean): number {
	let index = start;
	while (index < sql.length && predicate(sql[index])) {
		index++;
	}
	return index;
}

/** A letter, digit or `&` glued to a quote makes it an E'', U&'', B'' or X'' literal with its own escaping rules. */
function isPrefixCharacter(char: string): boolean {
	return isWordCharacter(char) || char === '&';
}

function isWordStart(char: string): boolean {
	return /[A-Za-z_]/.test(char) || char.charCodeAt(0) >= 0x80;
}

function isWordCharacter(char: string): boolean {
	return /[A-Za-z0-9_]/.test(char) || char.charCodeAt(0) >= 0x80;
}
