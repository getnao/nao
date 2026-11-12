import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useActiveProjectId } from '@/lib/active-project';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

/** A branch of a repository synced into the context, tested instead of the user's File Explorer changes. */
export interface UpstreamTestSource {
	repo: string;
	branch: string;
}

const STORAGE_KEY = 'nao-test-upstream-source';
const upstreamSourceListeners = new Set<() => void>();
const cachedSources = new Map<string, { serialized: string; source: UpstreamTestSource | null }>();

/**
 * The upstream branch runs test, or null for the user's File Explorer changes, shared by every run button of the
 * project. While the synced repositories load, the saved branch is kept and reported as being checked; it is ignored
 * when they do not include its repository or fail to load, as nothing here could unpick it.
 */
export function useUpstreamTestSource() {
	const storageKey = getStorageKey(useActiveProjectId());
	const storedSource = useSyncExternalStore(subscribeToUpstreamSource, () => readUpstreamSource(storageKey));
	const repos = useQuery({ ...trpc.testRun.listUpstreamRepos.queryOptions(), enabled: storedSource !== null });
	const isChecking = storedSource !== null && repos.isPending;
	const isRepoSynced = isChecking || (repos.data?.some((repo) => repo.name === storedSource?.repo) ?? false);
	const setSource = useCallback(
		(source: UpstreamTestSource | null) => setUpstreamSource(storageKey, source),
		[storageKey],
	);
	return [isRepoSynced ? storedSource : null, setSource, isChecking] as const;
}

export function formatUpstreamRef(source: UpstreamTestSource): string {
	return `${source.repo}:${source.branch}`;
}

function getStorageKey(projectId: string | null): string {
	return projectId ? `${STORAGE_KEY}:${projectId}` : STORAGE_KEY;
}

/** Returns the same object while the stored value is unchanged, as `useSyncExternalStore` requires. */
function readUpstreamSource(storageKey: string): UpstreamTestSource | null {
	const source = createLocalStorage<UpstreamTestSource>(storageKey).get();
	const serialized = JSON.stringify(source);
	const cached = cachedSources.get(storageKey);
	if (cached?.serialized === serialized) {
		return cached.source;
	}
	cachedSources.set(storageKey, { serialized, source });
	return source;
}

function subscribeToUpstreamSource(listener: () => void) {
	upstreamSourceListeners.add(listener);
	return () => {
		upstreamSourceListeners.delete(listener);
	};
}

function setUpstreamSource(storageKey: string, source: UpstreamTestSource | null) {
	createLocalStorage<UpstreamTestSource>(storageKey).set(source);
	upstreamSourceListeners.forEach((listener) => listener());
}
