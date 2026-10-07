import { TRPCClientError } from '@trpc/client';

import { setActiveProjectId } from './active-project';
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

export function clearStaleActiveOrganization(organizationId: string | null, error: unknown): boolean {
	if (
		!organizationId ||
		getActiveOrganizationId() !== organizationId ||
		!(error instanceof TRPCClientError) ||
		error.data?.code !== 'NOT_FOUND'
	) {
		return false;
	}

	setActiveOrganizationId(null);
	setActiveProjectId(null);
	return true;
}
