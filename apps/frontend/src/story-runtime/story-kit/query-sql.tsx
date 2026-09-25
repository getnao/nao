import { useEffect, useState } from 'react';
import { requestQuerySql } from '../story-host';
import type { ReactNode } from 'react';

type QuerySqlState =
	| { status: 'loading'; sql: null; error: null }
	| { status: 'success'; sql: string; error: null }
	| { status: 'error'; sql: null; error: string };

type SqlTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain';

const LOADING: QuerySqlState = { status: 'loading', sql: null, error: null };

const SQL_TOKEN_PATTERN =
	/(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|("(?:[^"]|"")*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

const SQL_KEYWORDS = new Set([
	'select',
	'from',
	'where',
	'and',
	'or',
	'not',
	'in',
	'is',
	'null',
	'as',
	'on',
	'join',
	'left',
	'right',
	'inner',
	'outer',
	'full',
	'cross',
	'group',
	'order',
	'by',
	'having',
	'limit',
	'offset',
	'with',
	'union',
	'all',
	'distinct',
	'case',
	'when',
	'then',
	'else',
	'end',
	'asc',
	'desc',
	'between',
	'like',
	'ilike',
	'exists',
	'over',
	'partition',
	'qualify',
	'interval',
	'cast',
	'true',
	'false',
	'using',
	'window',
	'rows',
	'range',
	'preceding',
	'following',
	'current',
	'row',
	'filter',
	'lateral',
	'unnest',
]);

const querySqlCache = new Map<string, Promise<string>>();

export function QuerySql({ queryId }: { queryId: string }) {
	const state = useQuerySql(queryId);

	if (state.status === 'loading') {
		return <div className='nao-skeleton' aria-busy='true' />;
	}
	if (state.status === 'error') {
		return <div className='nao-block__state nao-block__state--error'>{state.error}</div>;
	}
	return (
		<pre className='nao-sql'>
			<code>{highlightSql(state.sql.trim())}</code>
		</pre>
	);
}

function useQuerySql(queryId: string): QuerySqlState {
	const [state, setState] = useState<QuerySqlState>(LOADING);

	useEffect(() => {
		let cancelled = false;
		setState(LOADING);
		fetchQuerySql(queryId).then(
			(sql) => !cancelled && setState({ status: 'success', sql, error: null }),
			(error: unknown) =>
				!cancelled &&
				setState({ status: 'error', sql: null, error: error instanceof Error ? error.message : String(error) }),
		);
		return () => {
			cancelled = true;
		};
	}, [queryId]);

	return state;
}

function fetchQuerySql(queryId: string): Promise<string> {
	const cached = querySqlCache.get(queryId);
	if (cached) {
		return cached;
	}
	const request = requestQuerySql(queryId);
	querySqlCache.set(queryId, request);
	request.catch(() => querySqlCache.delete(queryId));
	return request;
}

function highlightSql(sql: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const match of sql.matchAll(SQL_TOKEN_PATTERN)) {
		const kind = tokenKind(match);
		if (kind === 'plain') {
			continue;
		}
		nodes.push(sql.slice(cursor, match.index));
		nodes.push(
			<span key={match.index} className={`nao-sql__${kind}`}>
				{match[0]}
			</span>,
		);
		cursor = match.index + match[0].length;
	}
	nodes.push(sql.slice(cursor));
	return nodes;
}

function tokenKind(match: RegExpMatchArray): SqlTokenKind {
	const [, comment, string, , number, word] = match;
	if (comment) {
		return 'comment';
	}
	if (string) {
		return 'string';
	}
	if (number) {
		return 'number';
	}
	return word && SQL_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'plain';
}
