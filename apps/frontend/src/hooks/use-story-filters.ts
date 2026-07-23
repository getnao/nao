import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isFilterSelectionActive } from '@nao/shared/sql-template';
import { getStoryFiltersFromCode } from '@nao/shared/story-segments';
import type { StoryFilterSelection, StoryFilterSelections } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

export type StoryFilterApi = { kind: 'owned'; chatId: string; storySlug: string } | { kind: 'shared'; shareId: string };

const FILTER_PARAM_PREFIX = 'story_filter_';

export function useStoryFilters({
	code,
	baselineQueryData,
	api,
	enabled = true,
}: {
	code: string;
	baselineQueryData?: QueryDataMap | null;
	api?: StoryFilterApi | null;
	enabled?: boolean;
}) {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const betaEnabled = config.data?.betaStoryFiltersEnabled === true;
	const filtersEnabled = enabled && betaEnabled;

	const filters = useMemo(
		() => (filtersEnabled ? dedupeFilters(getStoryFiltersFromCode(code)) : []),
		[code, filtersEnabled],
	);
	const [selections, setSelections] = useState<StoryFilterSelections>(() => readSelectionsFromUrl(filters));
	const skipNextUrlWrite = useRef(true);

	useEffect(() => {
		skipNextUrlWrite.current = true;
		if (!filtersEnabled) {
			return;
		}
		setSelections(readSelectionsFromUrl(filters));
	}, [filters, filtersEnabled]);

	useEffect(() => {
		if (!filtersEnabled) {
			return;
		}
		if (skipNextUrlWrite.current) {
			skipNextUrlWrite.current = false;
			return;
		}
		writeSelectionsToUrl(selections, filters);
	}, [selections, filters, filtersEnabled]);

	const setSelection = useCallback((filterId: string, selection: StoryFilterSelection) => {
		setSelections((current) => {
			const next = { ...current };
			if (isEmptySelection(selection)) {
				delete next[filterId];
			} else {
				next[filterId] = selection;
			}
			return next;
		});
	}, []);

	const clearSelections = useCallback(() => setSelections({}), []);

	const activeSelections = useMemo(() => {
		const active: StoryFilterSelections = {};
		for (const filter of filters) {
			const selection = selections[filter.id];
			if (isFilterSelectionActive(filter.filterType, selection)) {
				active[filter.id] = selection;
			}
		}
		return active;
	}, [filters, selections]);

	const hasActiveFilters = Object.keys(activeSelections).length > 0;
	const debouncedSelections = useDebouncedValue(activeSelections, 300);
	const debouncedHasActive = Object.keys(debouncedSelections).length > 0;

	const ownedQuery = useQuery({
		...trpc.story.getFilteredQueryData.queryOptions({
			chatId: api?.kind === 'owned' ? api.chatId : '',
			storySlug: api?.kind === 'owned' ? api.storySlug : '',
			selections: debouncedSelections,
		}),
		enabled: Boolean(filtersEnabled && api?.kind === 'owned' && debouncedHasActive),
		placeholderData: keepPreviousData,
	});

	const sharedQuery = useQuery({
		...trpc.storyShare.getFilteredQueryData.queryOptions({
			shareId: api?.kind === 'shared' ? api.shareId : '',
			selections: debouncedSelections,
		}),
		enabled: Boolean(filtersEnabled && api?.kind === 'shared' && debouncedHasActive),
		placeholderData: keepPreviousData,
	});

	const filteredQueryData = (api?.kind === 'shared' ? sharedQuery.data : ownedQuery.data) as QueryDataMap | undefined;
	const isFetching = api?.kind === 'shared' ? sharedQuery.isFetching : ownedQuery.isFetching;
	const isSelectionsPending = !areSelectionsEqual(activeSelections, debouncedSelections);
	const isFiltering = isSelectionsPending || isFetching;

	return {
		filtersEnabled,
		filters,
		selections,
		activeSelections,
		debouncedSelections,
		setSelection,
		clearSelections,
		hasActiveFilters,
		isFiltering,
		queryData: debouncedHasActive ? (filteredQueryData ?? baselineQueryData ?? null) : (baselineQueryData ?? null),
	};
}

function areSelectionsEqual(a: StoryFilterSelections, b: StoryFilterSelections): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	for (const key of aKeys) {
		if (!(key in b)) {
			return false;
		}
		const left = a[key];
		const right = b[key];
		if (Array.isArray(left) && Array.isArray(right)) {
			if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
				return false;
			}
			continue;
		}
		if (left !== right) {
			return false;
		}
	}
	return true;
}

function dedupeFilters(filters: ParsedFilterBlock[]): ParsedFilterBlock[] {
	const seen = new Set<string>();
	return filters.filter((filter) => {
		if (seen.has(filter.id)) {
			return false;
		}
		seen.add(filter.id);
		return true;
	});
}

function isEmptySelection(selection: StoryFilterSelection): boolean {
	return typeof selection === 'string'
		? selection.trim() === ''
		: selection.length === 0 || selection.every((value) => value.trim() === '');
}

function readSelectionsFromUrl(filters: ParsedFilterBlock[]): StoryFilterSelections {
	if (typeof window === 'undefined') {
		return {};
	}

	const params = new URLSearchParams(window.location.search);
	const selections: StoryFilterSelections = {};
	for (const filter of filters) {
		const raw = params.get(`${FILTER_PARAM_PREFIX}${filter.id}`);
		if (raw === null) {
			continue;
		}
		if (filter.filterType === 'select' || filter.filterType === 'search') {
			selections[filter.id] = raw;
			continue;
		}
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
				selections[filter.id] = parsed;
			}
		} catch {
			// ignore malformed URL values
		}
	}
	return selections;
}

function writeSelectionsToUrl(selections: StoryFilterSelections, filters: ParsedFilterBlock[]) {
	if (typeof window === 'undefined') {
		return;
	}

	const url = new URL(window.location.href);
	for (const key of [...url.searchParams.keys()]) {
		if (key.startsWith(FILTER_PARAM_PREFIX)) {
			url.searchParams.delete(key);
		}
	}

	const filterById = new Map(filters.map((filter) => [filter.id, filter]));
	for (const [filterId, selection] of Object.entries(selections)) {
		const filter = filterById.get(filterId);
		if (!filter || isEmptySelection(selection)) {
			continue;
		}
		const key = `${FILTER_PARAM_PREFIX}${filterId}`;
		if (filter.filterType === 'select' || filter.filterType === 'search') {
			url.searchParams.set(key, selection as string);
		} else {
			url.searchParams.set(key, JSON.stringify(selection));
		}
	}

	window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
