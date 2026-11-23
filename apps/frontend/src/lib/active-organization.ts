import { TRPCClientError } from '@trpc/client';

import { getActiveProjectId, setActiveProjectId } from './active-project';
import { createLocalStorage } from './local-storage';

const ACTIVE_ORGANIZATION_STORAGE_KEY = 'nao.active-organization-id';
const activeOrganizationStorage = createLocalStorage<string>(ACTIVE_ORGANIZATION_STORAGE_KEY);
const externalChangeListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key !== ACTIVE_ORGANIZATION_STORAGE_KEY) {
			return;
		}
		for (const listener of externalChangeListeners) {
			listener();
		}
	});
}

/** Every request reads the organization from storage, so a tab must follow the organization another tab selects. */
export function subscribeToExternalActiveOrganizationChanges(listener: () => void) {
	externalChangeListeners.add(listener);
	return () => {
		externalChangeListeners.delete(listener);
	};
}

export function getActiveOrganizationId(): string | null {
	if (typeof window === 'undefined') {
		return null;
	}

	return activeOrganizationStorage.get();
}

export function setActiveOrganizationId(organizationId: string | null): void {
	if (typeof window === 'undefined') {
		return;
	}

	activeOrganizationStorage.set(organizationId);
}

export function clearStaleActiveOrganization(
	organizationId: string | null,
	projectId: string | null,
	error: unknown,
): boolean {
	if (!(error instanceof TRPCClientError) || error.data?.code !== 'NOT_FOUND') {
		return false;
	}

	if (organizationId && getActiveOrganizationId() === organizationId) {
		setActiveOrganizationId(null);
		setActiveProjectId(null);
		return true;
	}

	if (!organizationId && !getActiveOrganizationId() && projectId && getActiveProjectId() === projectId) {
		setActiveProjectId(null);
		return true;
	}

	return false;
}
