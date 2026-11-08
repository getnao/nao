import type { QueryKey } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';

const STORY_ROUTERS = new Set(['story', 'storyShare', 'customStoryViewer', 'standaloneCustomStory']);
const QUERY_ID_ATTRIBUTE = /query_id=\\?["']([^"'\\]+)/g;

export interface StoryEdit {
	ranQueryIds: Set<string>;
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
	return { ranQueryIds: findRanQueryIds(message), referencedQueryIds: findReferencedQueryIds(message) };
}

/**
 * Only the results of the queries the agent ran go stale. Filtered results combine every query of the
 * story, so they are refetched when the agent ran one or wrote a block reading a query they lack.
 */
export function isOutdatedByEdit({ queryKey, state }: CachedQuery, edit: StoryEdit): boolean {
	const [path, options] = queryKey as [unknown, { input?: { queryId?: unknown; selections?: unknown } } | undefined];
	if (!Array.isArray(path) || !STORY_ROUTERS.has(path[0])) {
		return false;
	}
	const queryId = options?.input?.queryId;
	if (typeof queryId === 'string') {
		return edit.ranQueryIds.has(queryId);
	}
	if (options?.input?.selections === undefined) {
		return true;
	}
	return edit.ranQueryIds.size > 0 || lacksReferencedQuery(state.data, edit.referencedQueryIds);
}

function findRanQueryIds(message: UIMessage): Set<string> {
	return new Set(
		message.parts.flatMap((part) =>
			(part.type === 'tool-execute_sql' || part.type === 'tool-execute_semantic_query') &&
			part.state === 'output-available'
				? [part.output.id]
				: [],
		),
	);
}

function findReferencedQueryIds(message: UIMessage): Set<string> {
	const storyInputs = message.parts.flatMap((part) =>
		part.type === 'tool-story' && part.state === 'output-available' ? [JSON.stringify(part.input)] : [],
	);
	return new Set(storyInputs.flatMap((input) => [...input.matchAll(QUERY_ID_ATTRIBUTE)].map(([, id]) => id)));
}

function lacksReferencedQuery(data: unknown, referencedQueryIds: Set<string>): boolean {
	const cached = typeof data === 'object' && data !== null ? data : {};
	return [...referencedQueryIds].some((queryId) => !Object.hasOwn(cached, queryId));
}
