import { useCallback, useEffect, useRef, useState } from 'react';

export type HostRequestState<T> =
	| { status: 'loading'; data: null; error: null }
	| { status: 'success'; data: T; error: null }
	| { status: 'error'; data: null; error: string };

export type HostRequestResult<T> = HostRequestState<T> & {
	/** A new request is running while the answer to the previous one stays on screen. */
	isFetching: boolean;
	refetch: () => void;
};

export interface HostRequest<T> {
	/** What is asked for; the answer to an earlier request with the same source stays shown while the next one runs. */
	source: string;
	key: string;
	fetch: (fresh: boolean) => Promise<T>;
	/** How long the answer is reused; data follows the host's own freshness by default. */
	cacheForMs?: number;
}

const LOADING = { status: 'loading', data: null, error: null } as const;
const DEFAULT_CACHE_FOR_MS = 5 * 60 * 1000;
/** A viewer trying many filters or prompts does not keep every answer in memory. */
const MAX_CACHED_ANSWERS = 50;
const answerCache = new Map<string, { answer: Promise<unknown>; expiresAt: number }>();

/** Asks the host once per distinct request, sharing answers between every component of the story that asks the same. */
export function useHostRequest<T>(request: HostRequest<T>, enabled: boolean): HostRequestResult<T> {
	const [refreshes, setRefreshes] = useState(0);
	/** The request `refetch` was called for: the next fetch of it skips the cache, once. */
	const refreshKeyRef = useRef<string | null>(null);
	const [settled, setSettled] = useState<{ source: string; key: string; state: HostRequestState<T> } | null>(null);
	const requestKey = `${refreshes}:${request.key}`;

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let cancelled = false;
		const settle = (state: HostRequestState<T>) => {
			if (!cancelled) {
				setSettled({ source: request.source, key: requestKey, state });
			}
		};
		const fresh = refreshKeyRef.current === request.key;
		refreshKeyRef.current = null;
		fetchCached(request, fresh).then(
			(data) => settle({ status: 'success', data, error: null }),
			(error: unknown) => settle({ status: 'error', data: null, error: describeError(error) }),
		);
		return () => {
			cancelled = true;
		};
	}, [request, refreshes, enabled, requestKey]);

	const refetch = useCallback(() => {
		refreshKeyRef.current = request.key;
		setRefreshes((count) => count + 1);
	}, [request.key]);
	if (!enabled) {
		return { ...LOADING, isFetching: false, refetch };
	}
	if (settled?.key === requestKey) {
		return { ...settled.state, isFetching: false, refetch };
	}
	const keepsPreviousAnswer = settled?.source === request.source && settled.state.status === 'success';
	return { ...(keepsPreviousAnswer ? settled.state : LOADING), isFetching: true, refetch };
}

function fetchCached<T>(request: HostRequest<T>, fresh: boolean): Promise<T> {
	const cached = answerCache.get(request.key);
	if (!fresh && cached && cached.expiresAt > Date.now()) {
		return cached.answer as Promise<T>;
	}
	const answer = request.fetch(fresh);
	rememberAnswer(request.key, answer, request.cacheForMs ?? DEFAULT_CACHE_FOR_MS);
	answer.catch(() => {
		if (answerCache.get(request.key)?.answer === answer) {
			answerCache.delete(request.key);
		}
	});
	return answer;
}

/** A Map iterates in insertion order, so re-inserting a key makes it the newest and the first key is the oldest. */
function rememberAnswer(key: string, answer: Promise<unknown>, cacheForMs: number): void {
	answerCache.delete(key);
	answerCache.set(key, { answer, expiresAt: Date.now() + cacheForMs });
	while (answerCache.size > MAX_CACHED_ANSWERS) {
		const oldestKey = answerCache.keys().next().value;
		if (oldestKey === undefined) {
			return;
		}
		answerCache.delete(oldestKey);
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
