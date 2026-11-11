import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { serializeStoryQueryInputs } from '@nao/shared/story-query-inputs';
import { normalizeBrandHeader, showsBrandIdentity } from '@nao/shared/story-theme';
import {
	getStoryTheme,
	isEditingEnabled,
	requestQueryData,
	requestSql,
	subscribeToEditing,
	subscribeToTheme,
} from '../story-host';
import type { StoryQueryResult } from '@nao/shared/story-app';
import type { StoryQueryFilters, StoryQueryInputs } from '@nao/shared/story-query-inputs';
import type { StoryTheme } from '@nao/shared/story-theme';

export type QueryDataState =
	| { status: 'loading'; data: null; columns: null; error: null }
	| { status: 'success'; data: unknown[]; columns: string[]; error: null }
	| { status: 'error'; data: null; columns: null; error: string };

export type QueryDataResult = QueryDataState & {
	/** A new request is running while the rows of the previous one stay on screen. */
	isFetching: boolean;
	refetch: () => void;
};

export interface UseQueryDataOptions extends StoryQueryInputs {
	enabled?: boolean;
}

export interface UseSqlOptions {
	databaseId?: string;
	filters?: StoryQueryFilters;
	enabled?: boolean;
}

interface HostRequest {
	/** What is asked for; rows of an earlier request with the same source stay shown while the next one runs. */
	source: string;
	key: string;
	fetch: (fresh: boolean) => Promise<StoryQueryResult>;
}

const LOADING: QueryDataState = { status: 'loading', data: null, columns: null, error: null };
const resultCache = new Map<string, Promise<StoryQueryResult>>();

/** Rows of a saved query; `filters` and `params` re-run it on the server with the story's own selection. */
export function useQueryData(
	queryId: string,
	{ enabled = true, filters, params }: UseQueryDataOptions = {},
): QueryDataResult {
	const inputsKey = serializeStoryQueryInputs({ filters, params });
	const request = useMemo<HostRequest>(() => {
		const inputs: StoryQueryInputs = inputsKey ? JSON.parse(inputsKey) : {};
		return {
			source: `query:${queryId}`,
			key: `query:${queryId}:${inputsKey}`,
			fetch: (fresh) => requestQueryData(queryId, { fresh, ...inputs }),
		};
	}, [queryId, inputsKey]);
	return useHostRequest(request, enabled);
}

/**
 * Rows of SQL the story writes itself, run as the viewer: read-only and limited to what nao lets them query.
 * Its `{% filter %}` blocks render with `filters`, quoted on the server.
 */
export function useSql(sql: string, { databaseId, filters, enabled = true }: UseSqlOptions = {}): QueryDataResult {
	const filtersKey = serializeStoryQueryInputs({ filters });
	const request = useMemo<HostRequest>(() => {
		const inputs: StoryQueryInputs = filtersKey ? JSON.parse(filtersKey) : {};
		return {
			source: `sql:${databaseId ?? ''}`,
			key: `sql:${databaseId ?? ''}:${filtersKey}:${sql}`,
			fetch: (fresh) => requestSql(sql, { databaseId, filters: inputs.filters, fresh }),
		};
	}, [sql, databaseId, filtersKey]);
	return useHostRequest(request, enabled && sql.trim() !== '');
}

export function useStoryTheme(): StoryTheme | null {
	return useSyncExternalStore(subscribeToTheme, getStoryTheme);
}

/** The brand to show, normalized first so a theme saved before the header rules still renders its identity. */
export function useStoryBrand(): StoryTheme['brand'] | null {
	const brand = useStoryTheme()?.brand;
	const normalized = brand ? normalizeBrandHeader(brand) : null;
	return normalized && showsBrandIdentity(normalized) ? normalized : null;
}

export function useStoryEditing(): boolean {
	return useSyncExternalStore(subscribeToEditing, isEditingEnabled);
}

function useHostRequest(request: HostRequest, enabled: boolean): QueryDataResult {
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<{ source: string; key: string; state: QueryDataState } | null>(null);
	const requestKey = `${attempt}:${request.key}`;

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let cancelled = false;
		const settle = (state: QueryDataState) => {
			if (!cancelled) {
				setSettled({ source: request.source, key: requestKey, state });
			}
		};
		fetchCached(request, attempt > 0).then(
			(result) => settle({ status: 'success', data: result.data, columns: result.columns, error: null }),
			(error: unknown) => settle({ status: 'error', data: null, columns: null, error: describeError(error) }),
		);
		return () => {
			cancelled = true;
		};
	}, [request, attempt, enabled, requestKey]);

	const refetch = useCallback(() => setAttempt((current) => current + 1), []);
	if (!enabled) {
		return { ...LOADING, isFetching: false, refetch };
	}
	if (settled?.key === requestKey) {
		return { ...settled.state, isFetching: false, refetch };
	}
	const keepsPreviousRows = settled?.source === request.source && settled.state.status === 'success';
	return { ...(keepsPreviousRows ? settled.state : LOADING), isFetching: true, refetch };
}

function fetchCached(request: HostRequest, fresh: boolean): Promise<StoryQueryResult> {
	const cached = fresh ? undefined : resultCache.get(request.key);
	if (cached) {
		return cached;
	}
	const pending = request.fetch(fresh);
	resultCache.set(request.key, pending);
	pending.catch(() => {
		if (resultCache.get(request.key) === pending) {
			resultCache.delete(request.key);
		}
	});
	return pending;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
