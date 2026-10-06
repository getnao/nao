import { useEffect, useRef } from 'react';

interface UseRetryStaleStoryRefreshParams {
	storyKey: string;
	needsRefresh: boolean;
	isRefreshing: boolean;
	refresh: () => void;
}

/**
 * The server serves the stored data of a live story that was never cached or whose last refresh failed,
 * instead of refreshing inline, so the viewer runs the refresh in the background. It fires once each time
 * the story starts needing a refresh, never while one is already running (even from another viewer of the
 * story) and never in a loop when that refresh fails again.
 */
export function useRetryStaleStoryRefresh({
	storyKey,
	needsRefresh,
	isRefreshing,
	refresh,
}: UseRetryStaleStoryRefreshParams) {
	const refreshedStoryKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (isRefreshing) {
			refreshedStoryKeyRef.current = storyKey;
			return;
		}
		if (!needsRefresh) {
			refreshedStoryKeyRef.current = null;
			return;
		}
		if (refreshedStoryKeyRef.current === storyKey) {
			return;
		}
		refreshedStoryKeyRef.current = storyKey;
		refresh();
	}, [isRefreshing, needsRefresh, storyKey, refresh]);
}
