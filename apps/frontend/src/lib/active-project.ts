import { createLocalStorage } from './local-storage';

const activeProjectStorage = createLocalStorage<string>('nao.active-project-id');

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

	activeProjectStorage.set(projectId);
}
