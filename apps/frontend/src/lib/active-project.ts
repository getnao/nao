import { useSyncExternalStore } from 'react';

import { createLocalStorage } from './local-storage';

const ACTIVE_PROJECT_STORAGE_KEY = 'nao.active-project-id';
const activeProjectStorage = createLocalStorage<string>(ACTIVE_PROJECT_STORAGE_KEY);
const listeners = new Set<() => void>();
const externalChangeListeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key !== null && event.key !== ACTIVE_PROJECT_STORAGE_KEY) {
			return;
		}
		for (const listener of externalChangeListeners) {
			listener();
		}
		for (const listener of listeners) {
			listener();
		}
	});
}

export function subscribeToExternalActiveProjectChanges(listener: () => void) {
	externalChangeListeners.add(listener);
	return () => {
		externalChangeListeners.delete(listener);
	};
}

export function getActiveProjectId(): string | null {
	if (typeof window === 'undefined') {
		return null;
	}

	return activeProjectStorage.get();
}

export function setActiveProjectId(projectId: string | null): void {
	if (typeof window === 'undefined') {
		return;
	}

	if (projectId === getActiveProjectId()) {
		return;
	}
	activeProjectStorage.set(projectId);
	for (const listener of listeners) {
		listener();
	}
}

export function useActiveProjectId(): string | null {
	return useSyncExternalStore(subscribe, getActiveProjectId, () => null);
}

export function getProjectRequestHeaders(): Record<string, string> {
	const activeProjectId = getActiveProjectId();

	return activeProjectId ? { 'x-nao-project-id': activeProjectId } : {};
}
