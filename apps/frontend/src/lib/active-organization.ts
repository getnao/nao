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
