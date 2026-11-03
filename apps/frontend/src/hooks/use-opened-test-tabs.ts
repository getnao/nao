import { useCallback, useState } from 'react';

/** The tests opened as tabs in the Tests drawer, in the order they were opened. */
export function useOpenedTestTabs() {
	const [testPaths, setTestPaths] = useState<string[]>([]);

	const openTab = useCallback((testPath: string) => {
		setTestPaths((current) => (current.includes(testPath) ? current : [...current, testPath]));
	}, []);

	const closeTab = useCallback((testPath: string) => {
		setTestPaths((current) => current.filter((path) => path !== testPath));
	}, []);

	return { testPaths, openTab, closeTab };
}

/** The tab that takes the place of a closed one: the next tab, or the previous one when it was the last. */
export function getNeighborTab(testPaths: string[], closedPath: string): string | null {
	const index = testPaths.indexOf(closedPath);
	if (index === -1) {
		return null;
	}
	return testPaths[index + 1] ?? testPaths[index - 1] ?? null;
}
