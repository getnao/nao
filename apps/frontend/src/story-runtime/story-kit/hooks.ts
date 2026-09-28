import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getStoryTheme, isEditingEnabled, requestQueryData, subscribeToEditing } from '../story-host';
import type { StoryQueryResult } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

export type QueryDataState =
	| { status: 'loading'; data: null; columns: null; error: null }
	| { status: 'success'; data: unknown[]; columns: string[]; error: null }
	| { status: 'error'; data: null; columns: null; error: string };

export interface UseQueryDataOptions {
	enabled?: boolean;
}

const LOADING: QueryDataState = { status: 'loading', data: null, columns: null, error: null };
const resultCache = new Map<string, Promise<StoryQueryResult>>();

export function useQueryData(
	queryId: string,
	{ enabled = true }: UseQueryDataOptions = {},
): QueryDataState & { refetch: () => void } {
	const [state, setState] = useState<QueryDataState>(LOADING);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let cancelled = false;
		setState(LOADING);
		fetchQueryData(queryId, attempt > 0).then(
			(result) => {
				if (!cancelled) {
					setState({ status: 'success', data: result.data, columns: result.columns, error: null });
				}
			},
			(error: unknown) => {
				if (!cancelled) {
					setState({ status: 'error', data: null, columns: null, error: describeError(error) });
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [queryId, attempt, enabled]);

	const refetch = useCallback(() => setAttempt((current) => current + 1), []);
	return { ...state, refetch };
}

export function useStoryTheme(): StoryTheme | null {
	return getStoryTheme();
}

export function useStoryEditing(): boolean {
	return useSyncExternalStore(subscribeToEditing, isEditingEnabled);
}

function fetchQueryData(queryId: string, fresh: boolean): Promise<StoryQueryResult> {
	const cached = fresh ? undefined : resultCache.get(queryId);
	if (cached) {
		return cached;
	}
	const request = requestQueryData(queryId, { fresh });
	resultCache.set(queryId, request);
	request.catch(() => {
		if (resultCache.get(queryId) === request) {
			resultCache.delete(queryId);
		}
	});
	return request;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
