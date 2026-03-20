import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'nao-active-project-id';

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
	for (const l of listeners) {
		l();
	}
}

export const activeProjectStore = {
	get(): string | null {
		return localStorage.getItem(STORAGE_KEY);
	},

	set(projectId: string | null) {
		if (projectId) {
			localStorage.setItem(STORAGE_KEY, projectId);
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
		emit();
	},

	subscribe(listener: Listener) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};

export function useActiveProjectId(): [string | null, (id: string | null) => void] {
	const value = useSyncExternalStore(activeProjectStore.subscribe, activeProjectStore.get, () => null);
	return [value, activeProjectStore.set];
}
