import { useMemo, useSyncExternalStore } from 'react';

import type { UserRole } from '@nao/shared/types';

/**
 * Prototype store for the automation `admin_mode` flag (#2374). The backend has no column for it yet,
 * so the flag lives in localStorage, keyed by automation id.
 */
const STORAGE_KEY = 'nao:prototype:automation-admin-mode';

const listeners = new Set<() => void>();

export function canOwnAdminModeAutomation(role: UserRole | string | undefined): boolean {
	return role === 'admin' || role === 'context_admin';
}

export function useAutomationAdminMode(automationId: string | undefined): boolean {
	return useSyncExternalStore(subscribe, () => (automationId ? getAutomationAdminMode(automationId) : false));
}

export function useAdminModeAutomationIds(): ReadonlySet<string> {
	const storedIds = useSyncExternalStore(subscribe, () => localStorage.getItem(STORAGE_KEY));
	return useMemo(() => new Set(parseAdminModeIds(storedIds)), [storedIds]);
}

export function getAutomationAdminMode(automationId: string): boolean {
	return readAdminModeIds().includes(automationId);
}

export function setAutomationAdminMode(automationId: string, enabled: boolean): void {
	const otherIds = readAdminModeIds().filter((id) => id !== automationId);
	const nextIds = enabled ? [...otherIds, automationId] : otherIds;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(nextIds));
	listeners.forEach((listener) => listener());
}

function readAdminModeIds(): string[] {
	return parseAdminModeIds(localStorage.getItem(STORAGE_KEY));
}

function parseAdminModeIds(storedIds: string | null): string[] {
	try {
		const parsed: unknown = JSON.parse(storedIds ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
