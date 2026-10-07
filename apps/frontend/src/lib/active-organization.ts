import { TRPCClientError } from '@trpc/client';

import { getActiveProjectId, setActiveProjectId } from './active-project';
import { createLocalStorage } from './local-storage';

const activeOrganizationStorage = createLocalStorage<string>('nao.active-organization-id');

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

	if (!organizationId && projectId && getActiveProjectId() === projectId) {
		setActiveProjectId(null);
		return true;
	}

	return false;
}
