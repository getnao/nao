import type { QueryKey } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';

type MessagePart = UIMessage['parts'][number];

const STORY_ROUTERS = new Set(['story', 'storyShare', 'customStoryViewer', 'standaloneCustomStory']);
const QUERY_ID_ATTRIBUTE = /query_id=\\?["']([^"'\\]+)/g;
const QUERY_TABLE = /\bquery_[A-Za-z0-9_]+/g;
const FILTER_DEFINITION = /<(filter|parameter)\b/;

export interface StoryEdit {
	changedQueryIds: Set<string>;
	editsFilters: boolean;
	referencedQueryIds: Set<string>;
}

interface CachedQuery {
	queryKey: QueryKey;
	state: { data: unknown };
}

export function hasStoryEdit(message: UIMessage | undefined): boolean {
	return message?.role === 'assistant' && message.parts.some(isStoryEdit);
}

export function readStoryEdit(messages: UIMessage[]): StoryEdit {
	const storyInputs = readStoryInputs(messages.at(-1));
	return {
		changedQueryIds: withDependentQueries(findQueriesRunSincePreviousEdit(messages), readSqlByQueryId(messages)),
		editsFilters: storyInputs.some((input) => FILTER_DEFINITION.test(input)),
		referencedQueryIds: findReferencedQueryIds(storyInputs),
	};
}

/**
 * The story picks up a query the agent ran again under the same id with the edit, and so do the queries
 * reading it (`FROM query_x`). Filter and parameter definitions apply to every query, so editing them makes
 * all results stale. Filtered results combine every query of the story, so they also go stale when the edit
 * reads a query they lack.
 */
export function isOutdatedByEdit({ queryKey, state }: CachedQuery, edit: StoryEdit): boolean {
	const [path, options] = queryKey as [unknown, { input?: { queryId?: unknown; selections?: unknown } } | undefined];
	if (!Array.isArray(path) || !STORY_ROUTERS.has(path[0])) {
		return false;
	}
	const input = options?.input;
	if (typeof input?.queryId === 'string') {
		return edit.editsFilters || edit.changedQueryIds.has(input.queryId);
	}
	if (input?.selections === undefined) {
		return true;
	}
	return edit.editsFilters || isOutdatedFilteredResult(state.data, edit);
}

function findQueriesRunSincePreviousEdit(messages: UIMessage[]): Set<string> {
	const previousEditIndex = messages.slice(0, -1).map(hasStoryEdit).lastIndexOf(true);
	const sinceEdit = messages.slice(previousEditIndex + 1);
	return new Set(sinceEdit.flatMap((message) => message.parts.flatMap(readRanQueryId)));
}

function readSqlByQueryId(messages: UIMessage[]): Map<string, string> {
	const sqlByQueryId = new Map<string, string>();
	for (const part of messages.flatMap((message) => message.parts)) {
		if (part.type === 'tool-execute_sql' && part.state === 'output-available') {
			sqlByQueryId.set(part.output.id, part.input.sql_query);
		}
	}
	return sqlByQueryId;
}

function withDependentQueries(queryIds: Set<string>, sqlByQueryId: Map<string, string>): Set<string> {
	const outdated = new Set(queryIds);
	let hasFoundDependent = true;
	while (hasFoundDependent) {
		const dependents = [...sqlByQueryId].filter(
			([queryId, sql]) => !outdated.has(queryId) && readsAnyQuery(sql, outdated),
		);
		dependents.forEach(([queryId]) => outdated.add(queryId));
		hasFoundDependent = dependents.length > 0;
	}
	return outdated;
}

function readsAnyQuery(sql: string, queryIds: Set<string>): boolean {
	return (sql.match(QUERY_TABLE) ?? []).some((table) => queryIds.has(table));
}

function readRanQueryId(part: MessagePart): string[] {
	const isRanQuery =
		(part.type === 'tool-execute_sql' || part.type === 'tool-execute_semantic_query') &&
		part.state === 'output-available';
	return isRanQuery ? [part.output.id] : [];
}

function isStoryEdit(part: MessagePart): boolean {
	return part.type === 'tool-story' && part.state === 'output-available';
}

function readStoryInputs(message: UIMessage | undefined): string[] {
	return (message?.parts ?? []).flatMap((part) =>
		part.type === 'tool-story' && part.state === 'output-available' ? [JSON.stringify(part.input)] : [],
	);
}

function findReferencedQueryIds(storyInputs: string[]): Set<string> {
	return new Set(storyInputs.flatMap((input) => [...input.matchAll(QUERY_ID_ATTRIBUTE)].map(([, id]) => id)));
}

function isOutdatedFilteredResult(data: unknown, edit: StoryEdit): boolean {
	const cachedQueryIds = Object.keys(typeof data === 'object' && data !== null ? data : {});
	return (
		cachedQueryIds.some((queryId) => edit.changedQueryIds.has(queryId)) ||
		[...edit.referencedQueryIds].some((queryId) => !cachedQueryIds.includes(queryId))
	);
}
