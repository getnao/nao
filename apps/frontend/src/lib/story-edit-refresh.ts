import type { QueryKey } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';

const STORY_ROUTERS = new Set(['story', 'storyShare', 'customStoryViewer', 'standaloneCustomStory']);
const QUERY_ID_ATTRIBUTE = /query_id=\\?["']([^"'\\]+)/g;
const FILTER_DEFINITION = /<(filter|parameter)\b/;

export interface StoryEdit {
	hasRanQuery: boolean;
	editsFilters: boolean;
	referencedQueryIds: Set<string>;
}

interface CachedQuery {
	queryKey: QueryKey;
	state: { data: unknown };
}

export function hasStoryEdit(message: UIMessage | undefined): boolean {
	return (
		message?.role === 'assistant' &&
		message.parts.some((part) => part.type === 'tool-story' && part.state === 'output-available')
	);
}

export function readStoryEdit(message: UIMessage): StoryEdit {
	const storyInputs = readStoryInputs(message);
	return {
		hasRanQuery: message.parts.some(isRanQuery),
		editsFilters: storyInputs.some((input) => FILTER_DEFINITION.test(input)),
		referencedQueryIds: findReferencedQueryIds(storyInputs),
	};
}

/**
 * A query the agent ran may be read by other story queries (`FROM query_x`), and filter and parameter
 * definitions apply to every query, so either makes all query results stale. Otherwise only filtered
 * results, which combine every query of the story, go stale when the edit reads a query they lack.
 */
export function isOutdatedByEdit({ queryKey, state }: CachedQuery, edit: StoryEdit): boolean {
	const [path, options] = queryKey as [unknown, { input?: { queryId?: unknown; selections?: unknown } } | undefined];
	if (!Array.isArray(path) || !STORY_ROUTERS.has(path[0])) {
		return false;
	}
	const input = options?.input;
	const isFilteredResult = input?.selections !== undefined;
	if (typeof input?.queryId !== 'string' && !isFilteredResult) {
		return true;
	}
	if (edit.hasRanQuery || edit.editsFilters) {
		return true;
	}
	return isFilteredResult && lacksReferencedQuery(state.data, edit.referencedQueryIds);
}

function isRanQuery(part: UIMessage['parts'][number]): boolean {
	return (
		(part.type === 'tool-execute_sql' || part.type === 'tool-execute_semantic_query') &&
		part.state === 'output-available'
	);
}

function readStoryInputs(message: UIMessage): string[] {
	return message.parts.flatMap((part) =>
		part.type === 'tool-story' && part.state === 'output-available' ? [JSON.stringify(part.input)] : [],
	);
}

function findReferencedQueryIds(storyInputs: string[]): Set<string> {
	return new Set(storyInputs.flatMap((input) => [...input.matchAll(QUERY_ID_ATTRIBUTE)].map(([, id]) => id)));
}

function lacksReferencedQuery(data: unknown, referencedQueryIds: Set<string>): boolean {
	const cached = typeof data === 'object' && data !== null ? data : {};
	return [...referencedQueryIds].some((queryId) => !Object.hasOwn(cached, queryId));
}
