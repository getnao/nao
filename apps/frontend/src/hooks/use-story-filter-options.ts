import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

const SEARCH_DEBOUNCE_MS = 300;

export interface StoryFilterOptionsState {
	options: string[];
	/** False when the server truncated the list, so typed searches must go to the server. */
	isComplete: boolean;
	/** Every option for the current parent selection, or null while loading or when truncated. */
	completeOptions: string[] | null;
	isLoading: boolean;
	isSearching: boolean;
	error: string | null;
}

/**
 * Loads a select filter's options. Complete lists are searched in the browser; truncated lists
 * are searched on the server with the debounced term.
 */
export function useStoryFilterOptions({
	filter,
	api,
	search,
	parentSelection,
}: {
	filter: ParsedFilterBlock;
	api?: StoryFilterApi | null;
	search: string;
	parentSelection?: StoryFilterSelection;
}): StoryFilterOptionsState {
	const hardcodedOptions = filter.options?.length ? filter.options : null;
	const isRemote = !hardcodedOptions && Boolean(api);
	const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

	const baseQuery = useRemoteFilterOptions({ filter, api, parentSelection, enabled: isRemote });
	const needsServerSearch = isRemote && baseQuery.data?.isComplete === false && debouncedSearch !== '';
	const searchQuery = useRemoteFilterOptions({
		filter,
		api,
		parentSelection,
		search: debouncedSearch,
		enabled: needsServerSearch,
	});

	if (hardcodedOptions) {
		return {
			options: filterOptionsLocally(hardcodedOptions, search),
			isComplete: true,
			completeOptions: hardcodedOptions,
			isLoading: false,
			isSearching: false,
			error: null,
		};
	}

	const baseOptions = baseQuery.data?.options ?? [];
	const isComplete = baseQuery.data?.isComplete ?? true;
	const usesServerSearch = !isComplete && search.trim() !== '';

	return {
		options: usesServerSearch ? (searchQuery.data?.options ?? []) : filterOptionsLocally(baseOptions, search),
		isComplete,
		completeOptions: baseQuery.data?.isComplete ? baseQuery.data.options : null,
		isLoading: isRemote && baseQuery.isPending,
		isSearching: usesServerSearch && (search.trim() !== debouncedSearch || searchQuery.isFetching),
		error: baseQuery.error?.message ?? searchQuery.error?.message ?? null,
	};
}

function useRemoteFilterOptions({
	filter,
	api,
	parentSelection,
	search,
	enabled,
}: {
	filter: ParsedFilterBlock;
	api?: StoryFilterApi | null;
	parentSelection?: StoryFilterSelection;
	search?: string;
	enabled: boolean;
}) {
	const request = { filterId: filter.id, parentSelection, search: search || undefined };
	const placeholderData = search ? keepPreviousData : undefined;

	const ownedQuery = useQuery({
		...trpc.story.getFilterOptions.queryOptions({
			chatId: api?.kind === 'owned' ? api.chatId : '',
			storySlug: api?.kind === 'owned' ? api.storySlug : '',
			...request,
		}),
		enabled: enabled && api?.kind === 'owned',
		placeholderData,
	});

	const sharedQuery = useQuery({
		...trpc.storyShare.getFilterOptions.queryOptions({
			storyId: api?.kind === 'shared' ? api.storyId : '',
			...request,
		}),
		enabled: enabled && api?.kind === 'shared',
		placeholderData,
	});

	return api?.kind === 'shared' ? sharedQuery : ownedQuery;
}

function filterOptionsLocally(options: string[], search: string): string[] {
	const term = search.trim().toLowerCase();
	return term ? options.filter((option) => option.toLowerCase().includes(term)) : options;
}
