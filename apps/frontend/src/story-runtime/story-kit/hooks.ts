import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { serializeStoryQueryInputs, storyQueryRequestKey, storySqlRequestKey } from '@nao/shared/story-query-inputs';
import { normalizeBrandHeader, showsBrandIdentity } from '@nao/shared/story-theme';
import {
	getStoryTheme,
	isEditingEnabled,
	requestMapBoundary,
	requestQueryData,
	requestSql,
	subscribeToEditing,
	subscribeToTheme,
} from '../story-host';
import { useHostRequest } from './use-host-request';
import type { HostRequest, HostRequestResult } from './use-host-request';
import type { MapFeatureCollection } from '@nao/shared';
import type { StoryMapBoundary, StoryQueryResult } from '@nao/shared/story-app';
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

/** Rows of a saved query; `filters` and `params` re-run it on the server with the story's own selection. */
export function useQueryData(
	queryId: string,
	{ enabled = true, filters, params }: UseQueryDataOptions = {},
): QueryDataResult {
	const inputsKey = serializeStoryQueryInputs({ filters, params });
	const request = useMemo<HostRequest<StoryQueryResult>>(() => {
		const inputs: StoryQueryInputs = inputsKey ? JSON.parse(inputsKey) : {};
		return {
			source: `query:${queryId}`,
			key: storyQueryRequestKey(queryId, inputs),
			fetch: (fresh) => requestQueryData(queryId, { fresh, ...inputs }),
		};
	}, [queryId, inputsKey]);
	return toQueryDataResult(useHostRequest(request, enabled));
}

/**
 * Rows of SQL the story writes itself, run as the viewer: read-only and limited to what nao lets them query.
 * Its `{% filter %}` blocks render with `filters`, quoted on the server.
 */
export function useSql(sql: string, { databaseId, filters, enabled = true }: UseSqlOptions = {}): QueryDataResult {
	const filtersKey = serializeStoryQueryInputs({ filters });
	const request = useMemo<HostRequest<StoryQueryResult>>(() => {
		const inputs: StoryQueryInputs = filtersKey ? JSON.parse(filtersKey) : {};
		return {
			source: `sql:${databaseId ?? ''}`,
			key: storySqlRequestKey({ sql, databaseId, filters: inputs.filters }),
			fetch: (fresh) => requestSql(sql, { databaseId, filters: inputs.filters, fresh }),
		};
	}, [sql, databaseId, filtersKey]);
	return toQueryDataResult(useHostRequest(request, enabled && sql.trim() !== ''));
}

export type MapBoundaryState =
	| { status: 'loading'; data: null; joinProperties: null; error: null }
	| { status: 'success'; data: MapFeatureCollection; joinProperties: string[]; error: null }
	| { status: 'error'; data: null; joinProperties: null; error: string };

const LOADING_BOUNDARY: MapBoundaryState = { status: 'loading', data: null, joinProperties: null, error: null };
const boundaryCache = new Map<string, Promise<StoryMapBoundary>>();

/** A project boundary set as GeoJSON, for react-leaflet's `<GeoJSON data>`; regions match on `joinProperties`. */
export function useMapBoundary(key: string): MapBoundaryState {
	const [settled, setSettled] = useState<{ key: string; state: MapBoundaryState } | null>(null);

	useEffect(() => {
		let cancelled = false;
		const settle = (state: MapBoundaryState) => {
			if (!cancelled) {
				setSettled({ key, state });
			}
		};
		fetchMapBoundary(key).then(
			(boundary) =>
				settle({
					status: 'success',
					data: boundary.geojson,
					joinProperties: boundary.joinProperties,
					error: null,
				}),
			(error: unknown) =>
				settle({ status: 'error', data: null, joinProperties: null, error: describeError(error) }),
		);
		return () => {
			cancelled = true;
		};
	}, [key]);

	return settled?.key === key ? settled.state : LOADING_BOUNDARY;
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

function toQueryDataResult({ isFetching, refetch, ...state }: HostRequestResult<StoryQueryResult>): QueryDataResult {
	if (state.status === 'success') {
		return {
			status: 'success',
			data: state.data.data,
			columns: state.data.columns,
			error: null,
			isFetching,
			refetch,
		};
	}
	if (state.status === 'error') {
		return { status: 'error', data: null, columns: null, error: state.error, isFetching, refetch };
	}
	return { status: 'loading', data: null, columns: null, error: null, isFetching, refetch };
}

function fetchMapBoundary(key: string): Promise<StoryMapBoundary> {
	const cached = boundaryCache.get(key);
	if (cached) {
		return cached;
	}
	const request = requestMapBoundary(key);
	boundaryCache.set(key, request);
	request.catch(() => {
		if (boundaryCache.get(key) === request) {
			boundaryCache.delete(key);
		}
	});
	return request;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
