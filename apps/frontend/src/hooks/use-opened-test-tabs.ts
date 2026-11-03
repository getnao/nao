import { arrayMove } from '@dnd-kit/sortable';
import { useCallback, useState } from 'react';

/** The tests opened as tabs in the Tests drawer, in the order they were opened or then arranged. */
export function useOpenedTestTabs() {
	const [testPaths, setTestPaths] = useState<string[]>([]);

	const openTab = useCallback((testPath: string) => {
		setTestPaths((current) => (current.includes(testPath) ? current : [...current, testPath]));
	}, []);

	const closeTab = useCallback((testPath: string) => {
		setTestPaths((current) => current.filter((path) => path !== testPath));
	}, []);

	const moveTab = useCallback((testPath: string, targetPath: string) => {
		setTestPaths((current) => moveTabOnto(current, testPath, targetPath));
	}, []);

	return { testPaths, openTab, closeTab, moveTab };
}

/** Moves a tab to where another one is, shifting the tabs in between, as when dropping it there. */
export function moveTabOnto(testPaths: string[], testPath: string, targetPath: string): string[] {
	const fromIndex = testPaths.indexOf(testPath);
	const toIndex = testPaths.indexOf(targetPath);
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
		return testPaths;
	}
	return arrayMove(testPaths, fromIndex, toIndex);
}

/** The tab that takes the place of a closed one: the next tab, or the previous one when it was the last. */
export function getNeighborTab(testPaths: string[], closedPath: string): string | null {
	const index = testPaths.indexOf(closedPath);
	if (index === -1) {
		return null;
	}
	return testPaths[index + 1] ?? testPaths[index - 1] ?? null;
}
