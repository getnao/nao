import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';

import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

/** A branch of a repository synced into the context, tested instead of the user's File Explorer changes. */
export interface UpstreamTestSource {
	repo: string;
	branch: string;
}

const upstreamSourceStorage = createLocalStorage<UpstreamTestSource>('nao-test-upstream-source');
const upstreamSourceListeners = new Set<() => void>();
let cachedSerializedSource: string | null = null;
let cachedSource: UpstreamTestSource | null = null;

/**
 * The upstream branch runs test, or null for the user's File Explorer changes, shared by every run button. A branch
 * picked in a repository the current project does not sync is ignored once the repositories are known, as nothing
 * here could unpick it.
 */
export function useUpstreamTestSource() {
	const storedSource = useSyncExternalStore(subscribeToUpstreamSource, readUpstreamSource);
	const repos = useQuery({ ...trpc.testRun.listUpstreamRepos.queryOptions(), enabled: storedSource !== null });
	const isRepoSynced = repos.data ? repos.data.some((repo) => repo.name === storedSource?.repo) : true;
	return [isRepoSynced ? storedSource : null, setUpstreamSource] as const;
}

export function formatUpstreamRef(source: UpstreamTestSource): string {
	return `${source.repo}:${source.branch}`;
}

/** Returns the same object while the stored value is unchanged, as `useSyncExternalStore` requires. */
function readUpstreamSource(): UpstreamTestSource | null {
	const source = upstreamSourceStorage.get();
	const serialized = JSON.stringify(source);
	if (serialized !== cachedSerializedSource) {
		cachedSerializedSource = serialized;
		cachedSource = source;
	}
	return cachedSource;
}

function subscribeToUpstreamSource(listener: () => void) {
	upstreamSourceListeners.add(listener);
	return () => {
		upstreamSourceListeners.delete(listener);
	};
}

function setUpstreamSource(source: UpstreamTestSource | null) {
	upstreamSourceStorage.set(source);
	upstreamSourceListeners.forEach((listener) => listener());
}
