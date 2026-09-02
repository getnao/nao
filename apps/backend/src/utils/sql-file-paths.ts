import { isStoragePath, toStorageRelativePath } from './tools';

export interface RewrittenSql {
	sql: string;
	/** Paths inside the user's storage space the query asks for, in the order they appear. */
	storagePaths: string[];
}

const FILE_READER_CALL =
	/\b(?:read_(?:blob|csv(?:_auto)?|json(?:_auto|_objects)?|ndjson(?:_auto|_objects)?|parquet|text|xlsx))\s*\(/gi;

/**
 * Rewrites the virtual paths in a query's string literals to the real paths DuckDB has to open.
 *
 * Only literals are touched, and only ones addressing `/home`. Security does not rest on this
 * being exhaustive — DuckDB is confined to an allowlist of directories, so a literal this misses
 * fails to open rather than reaching somewhere it should not.
 */
export const rewriteStorageLiterals = (sql: string, toRealPath: (relativePath: string) => string): RewrittenSql => {
	const storagePaths: string[] = [];

	const rewritten = mapStringLiterals(sql, (literal, beforeLiteral) => {
		if (!isStoragePath(literal) || !isFilePathArgument(beforeLiteral)) {
			return literal;
		}

		const relativePath = toStorageRelativePath(literal);
		if (relativePath === '') {
			throw new Error(
				`'${literal}' is the root of your saved files, not a file. Name the file you want, e.g. '/home/uploads/sales.csv'.`,
			);
		}

		storagePaths.push(relativePath);
		return toRealPath(relativePath);
	});

	return { sql: rewritten, storagePaths };
};

/** The saved files a query asks for, as paths inside the user's storage space. */
export const storagePathsIn = (sql: string): string[] => {
	return rewriteStorageLiterals(sql, (relativePath) => relativePath).storagePaths;
};

/**
 * The query-result tables a query asks for, by the id they are named after. Literals are ignored so
 * that an id appearing inside a file path is not mistaken for a table.
 */
export const referencedQueryIds = (sql: string): string[] => {
	const withoutLiterals = mapStringLiterals(sql, () => '');
	const withoutComments = stripSqlComments(withoutLiterals);
	return [...new Set(withoutComments.match(/\bquery_[A-Za-z0-9_]+/g) ?? [])];
};

/**
 * Walks single-quoted literals, honouring the doubled-quote escape. Dollar-quoted strings are
 * left alone: they are vanishingly rare in a path argument, and leaving one is the safe failure.
 */
const mapStringLiterals = (sql: string, map: (literal: string, beforeLiteral: string) => string): string => {
	let result = '';
	let index = 0;

	while (index < sql.length) {
		const character = sql[index]!;
		const next = sql[index + 1];

		if (character === '-' && next === '-') {
			const end = sql.indexOf('\n', index + 2);
			const endIndex = end === -1 ? sql.length : end;
			result += sql.slice(index, endIndex);
			index = endIndex;
			continue;
		}

		if (character === '/' && next === '*') {
			const close = sql.indexOf('*/', index + 2);
			const endIndex = close === -1 ? sql.length : close + 2;
			result += sql.slice(index, endIndex);
			index = endIndex;
			continue;
		}

		if (character !== "'") {
			result += character;
			index += 1;
			continue;
		}

		const literal = readLiteral(sql, index);
		if (!literal) {
			// Unterminated quote: hand the rest back untouched and let the parser complain.
			result += sql.slice(index);
			break;
		}

		result += `'${escapeLiteral(map(literal.value, result))}'`;
		index = literal.endIndex;
	}

	return result;
};

const isFilePathArgument = (beforeLiteral: string): boolean => {
	const withoutLiterals = mapStringLiterals(beforeLiteral, () => '');
	const withoutComments = stripSqlComments(withoutLiterals);
	const calls = [...withoutComments.matchAll(FILE_READER_CALL)];
	const latest = calls.at(-1);
	if (latest?.index === undefined) {
		return false;
	}

	const afterOpenParen = withoutComments.slice(latest.index + latest[0].length);
	const structure = afterOpenParen.replaceAll("''", '');
	return /^\s*$/.test(structure) || /^\s*\[\s*(?:,\s*)*$/.test(structure);
};

const stripSqlComments = (sql: string): string => {
	return sql.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '));
};

const readLiteral = (sql: string, openIndex: number): { value: string; endIndex: number } | null => {
	let value = '';

	for (let index = openIndex + 1; index < sql.length; index += 1) {
		if (sql[index] !== "'") {
			value += sql[index];
			continue;
		}

		if (sql[index + 1] === "'") {
			value += "'";
			index += 1;
			continue;
		}

		return { value, endIndex: index + 1 };
	}

	return null;
};

const escapeLiteral = (value: string): string => {
	return value.replaceAll("'", "''");
};
