import { arrayMove } from '@dnd-kit/sortable';
import { useCallback, useState } from 'react';

/** The files opened as tabs, in the order they were opened or then arranged. */
export function useOpenedTabs(initialPaths: string[] = []) {
	const [paths, setPaths] = useState<string[]>(initialPaths);

	const openTab = useCallback((path: string) => {
		setPaths((current) => (current.includes(path) ? current : [...current, path]));
	}, []);

	const closeTabs = useCallback((closedPaths: string[]) => {
		setPaths((current) => current.filter((path) => !closedPaths.includes(path)));
	}, []);

	const closeTab = useCallback((path: string) => closeTabs([path]), [closeTabs]);

	const moveTab = useCallback((path: string, targetPath: string) => {
		setPaths((current) => moveTabOnto(current, path, targetPath));
	}, []);

	return { paths, openTab, closeTab, closeTabs, moveTab };
}

/** Moves a tab to where another one is, shifting the tabs in between, as when dropping it there. */
export function moveTabOnto(paths: string[], path: string, targetPath: string): string[] {
	const fromIndex = paths.indexOf(path);
	const toIndex = paths.indexOf(targetPath);
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
		return paths;
	}
	return arrayMove(paths, fromIndex, toIndex);
}

/**
 * The tab shown once some tabs close: the shown tab when it stays open, else the nearest open tab after it,
 * else the nearest one before it.
 */
export function getTabShownAfterClosing(paths: string[], closedPaths: string[], shownPath: string): string | null {
	if (!closedPaths.includes(shownPath)) {
		return shownPath;
	}
	const shownIndex = paths.indexOf(shownPath);
	if (shownIndex === -1) {
		return null;
	}
	const isOpen = (path: string) => !closedPaths.includes(path);
	return paths.slice(shownIndex + 1).find(isOpen) ?? paths.slice(0, shownIndex).reverse().find(isOpen) ?? null;
}
