import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isFilterSelectionActive } from '@nao/shared/sql-template';
import {
	getStoryFiltersFromCode,
	getStoryParametersFromCode,
	resolveStoryParameters,
} from '@nao/shared/story-segments';
import type { StoryFilterSelection, StoryFilterSelections } from '@nao/shared/sql-template';
import type { ParsedFilterBlock, ParsedParameterBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useStructurallyShared } from '@/hooks/use-structurally-shared';
import { trpc } from '@/main';

export type StoryFilterApi =
	| { kind: 'owned'; chatId: string; storySlug: string }
	| { kind: 'shared'; storyId: string }
	| { kind: 'standalone'; storyId: string };

const FILTER_PARAM_PREFIX = 'story_filter_';
const NO_SELECTIONS: StoryFilterSelections = {};
const NO_PARAMETERS: ParsedParameterBlock[] = [];
const NO_FILTERS: ParsedFilterBlock[] = [];
const NO_SKIPPED_FILTERS: SkippedStoryFilter[] = [];
const NO_LABELS: string[] = [];

export interface SkippedStoryFilter {
	id: string;
	label: string;
}

/** How the active story filters reached one query of the story. */
export type StoryQueryFilterStatus =
	| { state: 'filtered'; summary: string }
	| { state: 'skipped'; filterLabels: string[] }
	| { state: 'failed'; error: string };

export type StoryQueryFilterStatuses = Record<string, StoryQueryFilterStatus>;

/** Filter ids per query id: the filters that can change each query, whatever their selection. */
export type StoryFilterTargets = Record<string, string[]>;

const NO_FILTER_TARGETS: StoryFilterTargets = {};

const NO_QUERY_FILTER_STATUSES: StoryQueryFilterStatuses = {};

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

	const filters = useStructurallyShared(
		useMemo(
			() => (filtersEnabled ? dedupeFilters(getStoryFiltersFromCode(code)) : NO_FILTERS),
			[code, filtersEnabled],
		),
	);
	const parametersInCode = useStructurallyShared(useMemo(() => getStoryParametersFromCode(code), [code]));
	const parameters = useMemo(
		() => (filtersEnabled ? parametersInCode : NO_PARAMETERS),
		[parametersInCode, filtersEnabled],
	);
	const [selections, setSelections] = useState<StoryFilterSelections>(() =>
		readSelectionsFromUrl(filters, parameters),
	);
	const urlSelections = useDebouncedValue(selections, 300);
	const skipNextUrlWrite = useRef(true);

	useEffect(() => {
		skipNextUrlWrite.current = true;
		if (!filtersEnabled) {
			return;
		}
		setSelections(readSelectionsFromUrl(filters, parameters));
	}, [filters, parameters, filtersEnabled]);

	useEffect(() => {
		if (!filtersEnabled) {
			return;
		}
		if (skipNextUrlWrite.current) {
			skipNextUrlWrite.current = false;
			return;
		}
		writeSelectionsToUrl(urlSelections, filters, parameters);
	}, [urlSelections, filters, parameters, filtersEnabled]);

	const setSelection = useCallback(
		(filterId: string, selection: StoryFilterSelection) => {
			setSelections((current) => applyStoryFilterSelection(current, filterId, selection, filters));
		},
		[filters],
	);

	const clearSelections = useCallback(() => setSelections({}), []);

	const activeSelections = useMemo(() => {
		const active: StoryFilterSelections = {};
		for (const filter of filters) {
			const selection = selections[filter.id];
			if (isFilterSelectionActive(filter.filterType, selection, filter.valueType)) {
				active[filter.id] = selection;
			}
		}
		for (const parameter of parameters) {
			const selection = selections[parameter.id];
			if (isNonDefaultParameterValue(parameter, selection)) {
				active[parameter.id] = selection;
			}
		}
		return active;
	}, [filters, parameters, selections]);

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
			storyId: api?.kind === 'shared' ? api.storyId : '',
			selections: debouncedSelections,
		}),
		enabled: Boolean(filtersEnabled && api?.kind === 'shared' && debouncedHasActive),
		placeholderData: keepPreviousData,
	});

	const standaloneQuery = useQuery({
		...trpc.story.getStandaloneFilteredQueryData.queryOptions({
			storyId: api?.kind === 'standalone' ? api.storyId : '',
			selections: debouncedSelections,
		}),
		enabled: Boolean(filtersEnabled && api?.kind === 'standalone' && debouncedHasActive),
		placeholderData: keepPreviousData,
	});

	const activeQuery = { owned: ownedQuery, shared: sharedQuery, standalone: standaloneQuery }[api?.kind ?? 'owned'];
	const parameterSelections = useMemo(
		() => pickSelections(debouncedSelections, parameters),
		[debouncedSelections, parameters],
	);
	const filterTargets = useStoryFilterTargets(api, parameterSelections, filtersEnabled && filters.length > 0);
	const filteredQueryData = activeQuery.data as FilteredQueryDataMap | undefined;
	const isFetching = activeQuery.isFetching;
	const displayedSelections = useDisplayedSelections({
		debouncedSelections,
		isActive: debouncedHasActive,
		hasSettledData: Boolean(activeQuery.data) && !activeQuery.isPlaceholderData,
	});
	const resolvedParameters = useMemo(
		() => resolveStoryParameters(parametersInCode, displayedSelections),
		[parametersInCode, displayedSelections],
	);
	const skippedFilters = useMemo(
		() => (debouncedHasActive ? listSkippedFilters(filters, filteredQueryData) : NO_SKIPPED_FILTERS),
		[debouncedHasActive, filters, filteredQueryData],
	);
	const hasSettledData = !activeQuery.isPlaceholderData && !activeQuery.isFetching;
	const requestError = activeQuery.error?.message;
	const queryFilterStatuses = useMemo(
		() =>
			debouncedHasActive && hasSettledData
				? listQueryFilterStatuses({
						filters,
						selections: debouncedSelections,
						filterTargets,
						filteredQueryData,
						requestError,
						baselineQueryData,
					})
				: NO_QUERY_FILTER_STATUSES,
		[
			debouncedHasActive,
			hasSettledData,
			filters,
			debouncedSelections,
			filterTargets,
			filteredQueryData,
			requestError,
			baselineQueryData,
		],
	);
	const filterSummary = useMemo(
		() => summarizeSelections([...parameters, ...filters], debouncedSelections),
		[parameters, filters, debouncedSelections],
	);
	const isSelectionsPending = !areSelectionsEqual(activeSelections, debouncedSelections);
	const isFiltering = isSelectionsPending || isFetching;
	const queryData = useStructurallyShared(
		useMemo(
			() =>
				debouncedHasActive
					? withFilteredRows(baselineQueryData, filteredQueryData)
					: (baselineQueryData ?? null),
			[debouncedHasActive, baselineQueryData, filteredQueryData],
		),
	);

	return {
		filtersEnabled,
		filters,
		parameters,
		resolvedParameters,
		skippedFilters,
		queryFilterStatuses,
		filterSummary,
		filterTargets,
		selections,
		activeSelections,
		debouncedSelections,
		setSelection,
		clearSelections,
		hasActiveFilters,
		isFiltering,
		queryData,
	};
}

/** The labels of the parameters and filters written so far, shown as placeholders until the story is saved. */
export function useStreamingStoryFilterLabels(code: string, isStreaming: boolean): string[] {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isShown = isStreaming && config.data?.betaStoryFiltersEnabled === true;
	return useStructurallyShared(
		useMemo(
			() =>
				isShown
					? [...getStoryParametersFromCode(code), ...dedupeFilters(getStoryFiltersFromCode(code))].map(
							(block) => block.label,
						)
					: NO_LABELS,
			[code, isShown],
		),
	);
}

/** Sets one selection and clears the filters that cascade from it, so their stale values are never queried. */
export function applyStoryFilterSelection(
	selections: StoryFilterSelections,
	filterId: string,
	selection: StoryFilterSelection,
	filters: ParsedFilterBlock[],
): StoryFilterSelections {
	const next = { ...selections };
	if (isEmptySelection(selection)) {
		delete next[filterId];
	} else {
		next[filterId] = selection;
	}
	if (!isSameSelection(selections[filterId], next[filterId])) {
		for (const dependentId of listDependentFilterIds(filters, filterId)) {
			delete next[dependentId];
		}
	}
	return next;
}

function listDependentFilterIds(filters: ParsedFilterBlock[], parentId: string): Set<string> {
	const dependentIds = new Set<string>();
	const pending = [parentId];
	while (pending.length > 0) {
		const currentId = pending.pop();
		for (const filter of filters) {
			if (filter.dependsOn === currentId && filter.id !== parentId && !dependentIds.has(filter.id)) {
				dependentIds.add(filter.id);
				pending.push(filter.id);
			}
		}
	}
	return dependentIds;
}

type FilteredQueryDataMap = Record<string, QueryDataMap[string] & { skippedFilterIds?: string[]; error?: string }>;

/** Queries a filter could not rerun or that failed with it keep showing their unfiltered rows. */
function withFilteredRows(
	baselineQueryData: QueryDataMap | null | undefined,
	filteredQueryData: FilteredQueryDataMap | undefined,
): QueryDataMap | null {
	if (!filteredQueryData) {
		return baselineQueryData ?? null;
	}
	const succeeded = Object.entries(filteredQueryData).filter(([, result]) => !result.error);
	return { ...baselineQueryData, ...Object.fromEntries(succeeded) };
}

function useStoryFilterTargets(
	api: StoryFilterApi | null | undefined,
	selections: StoryFilterSelections,
	enabled: boolean,
): StoryFilterTargets {
	const ownedQuery = useQuery({
		...trpc.story.getFilterTargets.queryOptions({
			chatId: api?.kind === 'owned' ? api.chatId : '',
			storySlug: api?.kind === 'owned' ? api.storySlug : '',
			selections,
		}),
		enabled: enabled && api?.kind === 'owned',
	});
	const sharedQuery = useQuery({
		...trpc.storyShare.getFilterTargets.queryOptions({
			storyId: api?.kind === 'shared' ? api.storyId : '',
			selections,
		}),
		enabled: enabled && api?.kind === 'shared',
	});
	const standaloneQuery = useQuery({
		...trpc.story.getStandaloneFilterTargets.queryOptions({
			storyId: api?.kind === 'standalone' ? api.storyId : '',
			selections,
		}),
		enabled: enabled && api?.kind === 'standalone',
	});
	const query = { owned: ownedQuery, shared: sharedQuery, standalone: standaloneQuery }[api?.kind ?? 'owned'];
	return query.data ?? NO_FILTER_TARGETS;
}

/** A failed request fails every saved query; otherwise each query reports its own outcome. */
function listQueryFilterStatuses({
	filters,
	selections,
	filterTargets,
	filteredQueryData,
	requestError,
	baselineQueryData,
}: {
	filters: ParsedFilterBlock[];
	selections: StoryFilterSelections;
	filterTargets: StoryFilterTargets;
	filteredQueryData: FilteredQueryDataMap | undefined;
	requestError: string | undefined;
	baselineQueryData: QueryDataMap | null | undefined;
}): StoryQueryFilterStatuses {
	if (requestError) {
		return Object.fromEntries(
			Object.keys(baselineQueryData ?? {}).map((queryId) => [queryId, { state: 'failed', error: requestError }]),
		);
	}
	return Object.fromEntries(
		Object.entries(filteredQueryData ?? {}).flatMap(([queryId, result]) => {
			const appliedFilters = filters.filter(
				(filter) => filter.id in selections && filterTargets[queryId]?.includes(filter.id),
			);
			const status = toQueryFilterStatus(result, filters, appliedFilters, selections);
			return status ? [[queryId, status]] : [];
		}),
	);
}

/** Queries no active filter reached have no status. */
function toQueryFilterStatus(
	result: FilteredQueryDataMap[string],
	filters: ParsedFilterBlock[],
	appliedFilters: ParsedFilterBlock[],
	selections: StoryFilterSelections,
): StoryQueryFilterStatus | null {
	if (result.error) {
		return { state: 'failed', error: result.error };
	}
	if (result.skippedFilterIds?.length) {
		const skipped = filters.filter((filter) => result.skippedFilterIds!.includes(filter.id));
		return { state: 'skipped', filterLabels: skipped.map((filter) => filter.label) };
	}
	if (appliedFilters.length === 0) {
		return null;
	}
	return { state: 'filtered', summary: summarizeSelections(appliedFilters, selections) };
}

/** Parameters and filters in words, e.g. "Metric = revenue · Returned = false". */
function summarizeSelections(
	controls: (ParsedFilterBlock | ParsedParameterBlock)[],
	selections: StoryFilterSelections,
): string {
	return controls
		.filter((control) => control.id in selections)
		.map((control) => {
			const selection = selections[control.id];
			const value = Array.isArray(selection)
				? selection.join('filterType' in control && control.filterType === 'date_range' ? ' → ' : ', ')
				: selection;
			return `${control.label} = ${value}`;
		})
		.join(' · ');
}

function pickSelections(selections: StoryFilterSelections, controls: { id: string }[]): StoryFilterSelections {
	return Object.fromEntries(controls.filter(({ id }) => id in selections).map(({ id }) => [id, selections[id]]));
}

/**
 * The selections behind the data on screen: while new filtered data loads, the previous data stays
 * visible, so parameter labels must keep describing it rather than the newer selection.
 */
function useDisplayedSelections({
	debouncedSelections,
	isActive,
	hasSettledData,
}: {
	debouncedSelections: StoryFilterSelections;
	isActive: boolean;
	hasSettledData: boolean;
}): StoryFilterSelections {
	const [settledSelections, setSettledSelections] = useState<StoryFilterSelections>(NO_SELECTIONS);

	useEffect(() => {
		if (isActive && hasSettledData) {
			setSettledSelections(debouncedSelections);
		}
	}, [isActive, hasSettledData, debouncedSelections]);

	return isActive ? settledSelections : NO_SELECTIONS;
}

function listSkippedFilters(
	filters: ParsedFilterBlock[],
	queryData: FilteredQueryDataMap | undefined,
): SkippedStoryFilter[] {
	const skippedFilterIds = new Set(Object.values(queryData ?? {}).flatMap((result) => result.skippedFilterIds ?? []));
	return filters
		.filter((filter) => skippedFilterIds.has(filter.id))
		.map((filter) => ({ id: filter.id, label: filter.label }));
}

function isNonDefaultParameterValue(parameter: ParsedParameterBlock, selection: StoryFilterSelection | undefined) {
	return (
		typeof selection === 'string' &&
		selection !== parameter.defaultValue &&
		parameter.options.some((option) => option.value === selection)
	);
}

function areSelectionsEqual(a: StoryFilterSelections, b: StoryFilterSelections): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	return aKeys.every((key) => key in b && isSameSelection(a[key], b[key]));
}

function isSameSelection(left: StoryFilterSelection | undefined, right: StoryFilterSelection | undefined): boolean {
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}
	return left === right;
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

function readSelectionsFromUrl(
	filters: ParsedFilterBlock[],
	parameters: ParsedParameterBlock[],
): StoryFilterSelections {
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
		if (hasStringSelection(filter)) {
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
	for (const parameter of parameters) {
		const raw = params.get(`${FILTER_PARAM_PREFIX}${parameter.id}`);
		if (raw !== null) {
			selections[parameter.id] = raw;
		}
	}
	return selections;
}

function writeSelectionsToUrl(
	selections: StoryFilterSelections,
	filters: ParsedFilterBlock[],
	parameters: ParsedParameterBlock[],
) {
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
	const parameterIds = new Set(parameters.map((parameter) => parameter.id));
	for (const [filterId, selection] of Object.entries(selections)) {
		const filter = filterById.get(filterId);
		if ((!filter && !parameterIds.has(filterId)) || isEmptySelection(selection)) {
			continue;
		}
		const key = `${FILTER_PARAM_PREFIX}${filterId}`;
		if (!filter || hasStringSelection(filter)) {
			url.searchParams.set(key, selection as string);
		} else {
			url.searchParams.set(key, JSON.stringify(selection));
		}
	}

	window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function hasStringSelection(filter: ParsedFilterBlock): boolean {
	return filter.filterType === 'select' || filter.filterType === 'search' || filter.filterType === 'text';
}
