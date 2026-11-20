import { isTestFilePath } from '@nao/shared/test-paths';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import type { ContextExplorerSearch, TestDrawerSearch } from '@/lib/context-explorer-search';
import { getTabShownAfterClosing, useOpenedTabs } from '@/hooks/use-opened-tabs';
import { consumeOpenTestsSearch } from '@/lib/context-explorer-search';
import { trpc } from '@/main';

/**
 * The Tests drawer of the doc view. It follows the URL like the one of the file tree, but the doc view has no editor
 * for test files, so a test runs as it is saved.
 */
export function useDocViewTestDrawer(search: ContextExplorerSearch) {
	const navigate = useNavigate();
	const activeTestPath = search.test && isTestFilePath(search.test) ? search.test : null;
	const { paths, openTab, closeTab, moveTab } = useOpenedTabs(activeTestPath ? [activeTestPath] : []);
	const [openRequestId, setOpenRequestId] = useState(0);
	const savedTest = useQuery({
		...trpc.contextExplorer.readFile.queryOptions({ path: activeTestPath! }),
		enabled: !!activeTestPath,
	});

	const show = (location: TestDrawerSearch) => {
		void navigate({
			to: '.',
			search: (previous: ContextExplorerSearch) => ({
				...previous,
				test: location.test,
				testRun: location.testRun,
			}),
		});
	};

	const openSuite = () => {
		show({});
		setOpenRequestId((current) => current + 1);
	};

	const closeTestTab = (testPath: string) => {
		closeTab(testPath);
		if (testPath === activeTestPath) {
			show({ test: getTabShownAfterClosing(paths, [testPath], testPath) ?? undefined });
		}
	};

	useEffect(() => {
		if (activeTestPath) {
			openTab(activeTestPath);
		}
	}, [activeTestPath, openTab]);

	useEffect(() => {
		if (search.tests !== 'open') {
			return;
		}
		setOpenRequestId((current) => current + 1);
		void navigate({ to: '.', search: consumeOpenTestsSearch, replace: true });
	}, [search.tests, navigate]);

	return {
		openSuite,
		layout: {
			testTabs: paths,
			activeTestPath,
			activeTestFile:
				activeTestPath && savedTest.data ? { path: activeTestPath, content: savedTest.data.content } : null,
			selectedRunId: search.testRun ?? null,
			openRequestId,
			onSelectTab: (testPath: string | null, runId?: string) => {
				show({ test: testPath ?? undefined, testRun: runId });
			},
			onCloseTab: closeTestTab,
			onMoveTab: moveTab,
			onSelectRun: (runId: string | null) => {
				show({ test: activeTestPath ?? undefined, testRun: runId ?? undefined });
			},
			onOpenTest: (testPath: string, runId?: string) => {
				show({ test: testPath, testRun: runId });
			},
		},
	};
}
