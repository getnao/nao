import { useSyncExternalStore } from 'react';

export interface GroupAdvancedSettingsAccess {
	showAllSettings: boolean;
	isDefault: boolean;
	memberIds: string[];
}

type AdvancedSettingsAccessStore = Record<string, GroupAdvancedSettingsAccess>;

export const ACCOUNT_SETTINGS_PATH = '/settings/account';

/** Prototype mock: group grants live in localStorage until the backend persists them. */
const STORAGE_KEY = 'nao.prototype.advanced-settings-access';
const listeners = new Set<() => void>();
let cachedRawStore: string | null = null;
let cachedStore: AdvancedSettingsAccessStore = {};

export function useAdvancedSettingsAccessStore(): AdvancedSettingsAccessStore {
	return useSyncExternalStore(subscribe, readStore, readStore);
}

export function getGroupShowsAllSettings(
	store: AdvancedSettingsAccessStore,
	group: { id: string; isDefault: boolean },
): boolean {
	return store[group.id]?.showAllSettings ?? group.isDefault;
}

export function saveGroupAdvancedSettingsAccess(groupId: string, access: GroupAdvancedSettingsAccess) {
	writeStore({ ...readStore(), [groupId]: access });
}

/** Only the User role is restricted: admins and context admins keep their settings, viewers stay account-only. */
export function canSeeAdvancedSettings(
	store: AdvancedSettingsAccessStore,
	role: string | null | undefined,
	userId: string | undefined,
): boolean {
	if (role !== 'user') {
		return true;
	}
	const groups = Object.values(store);
	const defaultGroup = groups.find((group) => group.isDefault);
	if (!defaultGroup || defaultGroup.showAllSettings) {
		return true;
	}
	return groups.some((group) => group.showAllSettings && !!userId && group.memberIds.includes(userId));
}

export function readAdvancedSettingsAccessStore(): AdvancedSettingsAccessStore {
	return readStore();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	window.addEventListener('storage', listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener('storage', listener);
	};
}

function readStore(): AdvancedSettingsAccessStore {
	const rawStore = readRawStore();
	if (rawStore !== cachedRawStore) {
		cachedRawStore = rawStore;
		cachedStore = parseStore(rawStore);
	}
	return cachedStore;
}

function writeStore(store: AdvancedSettingsAccessStore) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
		/* localStorage unavailable */
	}
	listeners.forEach((listener) => listener());
}

function readRawStore(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function parseStore(rawStore: string | null): AdvancedSettingsAccessStore {
	if (!rawStore) {
		return {};
	}
	try {
		const parsed = JSON.parse(rawStore);
		return parsed && typeof parsed === 'object' ? (parsed as AdvancedSettingsAccessStore) : {};
	} catch {
		return {};
	}
}
