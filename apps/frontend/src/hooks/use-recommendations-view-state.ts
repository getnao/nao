import { useCallback, useState } from 'react';

import { getActiveProjectId } from '@/lib/active-project';

const STORAGE_KEY_PREFIX = 'nao.recommendations-view';

function storageKey(): string {
	return `${STORAGE_KEY_PREFIX}.${getActiveProjectId() ?? 'default'}`;
}

function read<T extends Record<string, unknown>>(defaults: T): T {
	try {
		const stored = localStorage.getItem(storageKey());
		if (!stored) {
			return defaults;
		}
		const parsed: unknown = JSON.parse(stored);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return defaults;
		}
		return { ...defaults, ...(parsed as Partial<T>) };
	} catch {
		return defaults;
	}
}

function write<T extends Record<string, unknown>>(value: T): void {
	try {
		localStorage.setItem(storageKey(), JSON.stringify(value));
	} catch {
		// ignore errors
	}
}

export function useRecommendationsViewState<T extends Record<string, unknown>>(
	defaults: T,
): [T, (patch: Partial<T>) => void] {
	const [state, setState] = useState<T>(() => read(defaults));

	const patchState = useCallback((patch: Partial<T>) => {
		setState((prev) => {
			const next = { ...prev, ...patch };
			write(next);
			return next;
		});
	}, []);

	return [state, patchState];
}
