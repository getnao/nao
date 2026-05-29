import { useCallback, useState } from 'react';

const STORAGE_KEY = 'sidebar-collapsed-sections';

function readCollapsed(): Set<string> {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) {
			return new Set();
		}
		const parsed = JSON.parse(stored);
		return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
	} catch {
		return new Set();
	}
}

function writeCollapsed(set: Set<string>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
	} catch {
		// Ignore quota / availability errors
	}
}

/**
 * Persists the open/closed state of a sidebar section in localStorage.
 * Sections default to open; only collapsed sections are stored, keyed by `key`.
 */
export function useSidebarSectionOpen(key: string, defaultOpen = true) {
	const [isOpen, setIsOpenState] = useState<boolean>(() => {
		const collapsed = readCollapsed();
		return collapsed.has(key) ? false : defaultOpen;
	});

	const setIsOpen = useCallback(
		(value: boolean | ((prev: boolean) => boolean)) => {
			setIsOpenState((prev) => {
				const next = typeof value === 'function' ? value(prev) : value;
				const collapsed = readCollapsed();
				if (next) {
					collapsed.delete(key);
				} else {
					collapsed.add(key);
				}
				writeCollapsed(collapsed);
				return next;
			});
		},
		[key],
	);

	const toggle = useCallback(() => setIsOpen((prev) => !prev), [setIsOpen]);

	return { isOpen, setIsOpen, toggle };
}
