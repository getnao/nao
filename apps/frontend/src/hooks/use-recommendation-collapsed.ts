import { useCallback, useState } from 'react';

const STORAGE_KEY = 'recommendation-card-collapsed';

function readState(): Record<string, boolean> {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) {
			return {};
		}
		const parsed: unknown = JSON.parse(stored);
		return parseState(parsed);
	} catch {
		return {};
	}
}

function parseState(value: unknown): Record<string, boolean> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	return Object.fromEntries(Object.entries(value).filter(([, collapsed]) => typeof collapsed === 'boolean'));
}

function writeState(state: Record<string, boolean>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Ignore quota / availability errors
	}
}

/**
 * Persists the collapsed state of a recommendation card in localStorage, keyed by id.
 * Falls back to `defaultCollapsed` until the card has been toggled.
 */
export function useRecommendationCollapsed(id: string, defaultCollapsed = false) {
	const [collapsed, setCollapsedState] = useState<boolean>(() => {
		const state = readState();
		return Object.hasOwn(state, id) ? state[id] : defaultCollapsed;
	});

	const setCollapsed = useCallback(
		(value: boolean | ((prev: boolean) => boolean)) => {
			setCollapsedState((prev) => {
				const next = typeof value === 'function' ? value(prev) : value;
				const state = readState();
				state[id] = next;
				writeState(state);
				return next;
			});
		},
		[id],
	);

	return [collapsed, setCollapsed] as const;
}
