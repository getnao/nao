import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, useBlocker, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDefaultLayout } from 'react-resizable-panels';
import type { ShouldBlockFn } from '@tanstack/react-router';

import type { FileSelectionOptions } from '@/components/settings/file-tree';
import type { ContextExplorerSearch, TestDrawerSearch } from '@/lib/context-explorer-search';

import { ContextFileDiff } from '@/components/settings/context-file-diff';
import { ContextGitPanel } from '@/components/settings/context-git-panel';
import { FileTree } from '@/components/settings/file-tree';
import { FileViewer } from '@/components/settings/file-viewer';
import { TestDrawerLayout } from '@/components/settings/test-drawer';
import { isTestFilePath } from '@/components/settings/test-run-types';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { getNeighborTab, useOpenedTestTabs } from '@/hooks/use-opened-test-tabs';
import {
	consumeHistoricalContextDiffSearch,
	getHistoricalContextDiffTarget,
	validateContextExplorerSearch,
} from '@/lib/context-explorer-search';
import { createLocalStorage } from '@/lib/local-storage';
import { requireContextAdminOrAdmin } from '@/lib/route-guards';
import { trpc } from '@/main';

const contentSearchStorage = createLocalStorage<boolean>('nao-file-explorer-content-search', true);

type ViewerTarget = (
	| { type: 'file'; path: string; openSource: boolean }
	| { type: 'diff'; path: string }
	| { type: 'empty' }
) & { closedTestTab?: string };
type SourceAutoOpenRequest = { path: string; id: number };

export const Route = createFileRoute('/_sidebar-layout/settings/context-explorer')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateContextExplorerSearch,
	component: ContextExplorerPage,
});

function ContextExplorerPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const {
		path: initialPath,
		from: historicalFrom,
		to: historicalTo,
		test: testDrawerTest,
		testRun: testDrawerRun,
	} = Route.useSearch();
	const activeTestPath = testDrawerTest && isTestFilePath(testDrawerTest) ? testDrawerTest : null;
	const initialHistoricalDiff = getHistoricalContextDiffTarget({
		path: initialPath,
		from: historicalFrom,
		to: historicalTo,
	});
	const [selectedPath, setSelectedPath] = useState<string | null>(() => initialPath ?? null);
	const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
	const [historicalDiff, setHistoricalDiff] = useState(() => initialHistoricalDiff);
	const [pendingViewerTarget, setPendingViewerTarget] = useState<ViewerTarget | null>(null);
	const [sourceAutoOpenRequest, setSourceAutoOpenRequest] = useState<SourceAutoOpenRequest | null>(null);
	const [viewerRevision, setViewerRevision] = useState(0);
	const [isViewerDirty, setIsViewerDirty] = useState(false);
	const [editorDraft, setEditorDraft] = useState<{ path: string; content: string } | null>(null);
	const [testDrawerOpenRequestId, setTestDrawerOpenRequestId] = useState(0);
	const [syncedTestPath, setSyncedTestPath] = useState<string | null>(null);
	const openedTestTabs = useOpenedTestTabs();
	const hasResolvedInitialTestTabRef = useRef(false);
	const [search, setSearch] = useState('');
	const [isContentSearchEnabled, setIsContentSearchEnabled] = useLocalStorage(contentSearchStorage);
	const trimmedSearch = search.trim();
	const contentSearchQuery = trimmedSearch.slice(0, 200);
	const debouncedSearch = useDebouncedValue(contentSearchQuery, 250);
	const isLiveContentSearchEligible = isContentSearchEnabled && trimmedSearch.length >= 2;
	const shouldSearchContent = isContentSearchEnabled && debouncedSearch.length >= 2;
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: 'context-explorer',
		storage: localStorage,
	});
	const editorTestPath =
		!historicalDiff && !selectedDiffPath && selectedPath && isTestFilePath(selectedPath) ? selectedPath : null;
	const activeTestFile = activeTestPath && editorDraft?.path === activeTestPath ? editorDraft : null;
	const handleEditorDraftChange = useCallback((path: string, content: string) => {
		setEditorDraft({ path, content });
	}, []);
	const shouldBlockNavigation = useCallback<ShouldBlockFn>(
		({ current, next, action }) => {
			if (!isViewerDirty) {
				return false;
			}
			if (current.pathname !== next.pathname) {
				return true;
			}
			const isHistoryStep = action === 'BACK' || action === 'FORWARD' || action === 'GO';
			const nextTestPath = (next.search as ContextExplorerSearch).test;
			return isHistoryStep && nextTestPath !== undefined && nextTestPath !== selectedPath;
		},
		[isViewerDirty, selectedPath],
	);
	const navigationBlocker = useBlocker({
		shouldBlockFn: shouldBlockNavigation,
		enableBeforeUnload: isViewerDirty,
		disabled: !isViewerDirty,
		withResolver: true,
	});

	useEffect(() => {
		if (hasResolvedInitialTestTabRef.current) {
			return;
		}
		hasResolvedInitialTestTabRef.current = true;
		if (!testDrawerTest && editorTestPath) {
			void navigate({
				to: '/settings/context-explorer',
				search: (previous) => ({ ...previous, test: editorTestPath }),
				replace: true,
			});
		}
	}, [editorTestPath, navigate, testDrawerTest]);

	useEffect(() => {
		const target = getHistoricalContextDiffTarget({
			path: initialPath,
			from: historicalFrom,
			to: historicalTo,
		});
		if (!target) {
			return;
		}
		setSelectedPath(target.path);
		setSelectedDiffPath(null);
		setHistoricalDiff(target);
		void navigate({
			to: '/settings/context-explorer',
			search: consumeHistoricalContextDiffSearch(target),
			replace: true,
		});
	}, [historicalFrom, historicalTo, initialPath, navigate]);

	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const rulesPreviewGroups = useQuery(trpc.contextExplorer.getRulesPreviewGroups.queryOptions());
	const rulesPreviewGroupsState = rulesPreviewGroups.isLoading
		? ({ status: 'loading' } as const)
		: rulesPreviewGroups.isError || !rulesPreviewGroups.data
			? ({ status: 'error' } as const)
			: ({ status: 'ready', ...rulesPreviewGroups.data } as const);
	const fileContent = useQuery({
		...trpc.contextExplorer.readFile.queryOptions({ path: selectedPath! }),
		enabled: !!selectedPath,
	});
	const contentSearch = useQuery({
		...trpc.contextExplorer.searchContent.queryOptions({ query: debouncedSearch }),
		enabled: shouldSearchContent,
		placeholderData: keepPreviousData,
	});
	const isContentSearchPending =
		isLiveContentSearchEligible && (contentSearchQuery !== debouncedSearch || contentSearch.isFetching);
	const contentMatches = useMemo(() => {
		if (!isLiveContentSearchEligible || !shouldSearchContent) {
			return new Map();
		}
		return new Map(
			(contentSearch.data?.results ?? []).map((match) => [
				match.path,
				{ count: match.count, line: match.line, text: match.text },
			]),
		);
	}, [contentSearch.data?.results, isLiveContentSearchEligible, shouldSearchContent]);

	const requestSourceAutoOpen = (path: string) => {
		setSourceAutoOpenRequest((current) => ({ path, id: (current?.id ?? 0) + 1 }));
	};

	/** Moves the Tests drawer as a new browser history step, so going back returns to where it was. */
	const navigateTestDrawer = (location: TestDrawerSearch) => {
		if (location.test === testDrawerTest && location.testRun === testDrawerRun) {
			return;
		}
		void navigate({
			to: '/settings/context-explorer',
			search: (previous) => ({ ...previous, test: location.test, testRun: location.testRun }),
		});
	};

	const openTestSuite = () => {
		navigateTestDrawer({});
		setTestDrawerOpenRequestId((current) => current + 1);
	};

	const selectTestTab = (testPath: string | null) => {
		if (testPath === null || testPath === editorTestPath) {
			navigateTestDrawer({ test: testPath ?? undefined });
			return;
		}
		requestViewerTarget({ type: 'file', path: testPath, openSource: false });
	};

	/** Closing the tab of the test in the editor also closes the file, or opens the neighbor tab when it was shown. */
	const closeTestTab = (testPath: string) => {
		const isShown = testPath === activeTestPath;
		const neighborPath = isShown ? getNeighborTab(openedTestTabs.testPaths, testPath) : null;
		if (neighborPath) {
			requestViewerTarget({ type: 'file', path: neighborPath, openSource: false, closedTestTab: testPath });
		} else if (testPath === editorTestPath) {
			requestViewerTarget({ type: 'empty', closedTestTab: testPath });
		} else {
			openedTestTabs.closeTab(testPath);
			if (isShown) {
				navigateTestDrawer({});
			}
		}
	};

	const selectTestRun = (runId: string | null) => {
		navigateTestDrawer({ test: activeTestPath ?? undefined, testRun: runId ?? undefined });
	};

	/** The Tests drawer follows the file in the editor: a test shows its tab, any other file all the tests. */
	const syncTestDrawerWithFile = (path: string | null) => {
		if (path && isTestFilePath(path)) {
			openedTestTabs.openTab(path);
			navigateTestDrawer({ test: path });
		} else if (activeTestPath) {
			navigateTestDrawer({});
		}
	};

	const showFile = (path: string | null) => {
		setSelectedPath(path);
		setSelectedDiffPath(null);
		setHistoricalDiff(null);
		setSourceAutoOpenRequest(null);
	};

	const applyViewerTarget = (target: ViewerTarget) => {
		if (target.closedTestTab) {
			openedTestTabs.closeTab(target.closedTestTab);
		}
		if (target.type === 'file') {
			showFile(target.path);
			syncTestDrawerWithFile(target.path);
			if (target.openSource) {
				requestSourceAutoOpen(target.path);
			}
			return;
		}
		if (target.type === 'empty') {
			showFile(null);
			syncTestDrawerWithFile(null);
			return;
		}
		setHistoricalDiff(null);
		setSelectedDiffPath(target.path);
	};

	const requestViewerTarget = (target: ViewerTarget) => {
		if (isViewerDirty) {
			setPendingViewerTarget(target);
			return;
		}
		applyViewerTarget(target);
	};

	const handleSelectFile = (path: string, options: FileSelectionOptions) => {
		if (path === selectedPath && selectedDiffPath === null && historicalDiff === null) {
			if (options.isContentMatch) {
				requestSourceAutoOpen(path);
			}
			if (isTestFilePath(path) && path !== activeTestPath) {
				syncTestDrawerWithFile(path);
			}
			return;
		}
		requestViewerTarget({ type: 'file', path, openSource: options.isContentMatch });
	};

	const handleViewDiff = (path: string) => {
		if (path === selectedDiffPath) {
			return;
		}
		requestViewerTarget({ type: 'diff', path });
	};

	const handleChangesCommitted = async (paths: string[]) => {
		if (!selectedDiffPath || !paths.includes(selectedDiffPath)) {
			return;
		}
		const committedDiffPath = selectedDiffPath;
		setSelectedDiffPath(null);
		await queryClient.cancelQueries({
			queryKey: trpc.contextExplorer.getFileDiff.queryKey({ path: committedDiffPath }),
		});
	};

	const handleDiscardAndChangeView = () => {
		if (!pendingViewerTarget) {
			return;
		}
		setIsViewerDirty(false);
		applyViewerTarget(pendingViewerTarget);
		setPendingViewerTarget(null);
	};

	const handleLocalChangeDiscarded = async (path: string) => {
		if (selectedDiffPath === path) {
			setSelectedDiffPath(null);
		}
		if (selectedPath !== path) {
			return;
		}
		setIsViewerDirty(false);
		await queryClient.invalidateQueries({
			queryKey: trpc.contextExplorer.readFile.queryKey({ path }),
		});
		setViewerRevision((current) => current + 1);
	};

	const handleAllLocalChangesDiscarded = async () => {
		setSelectedDiffPath(null);
		setIsViewerDirty(false);
		if (selectedPath) {
			await queryClient.invalidateQueries({
				queryKey: trpc.contextExplorer.readFile.queryKey({ path: selectedPath }),
			});
			setViewerRevision((current) => current + 1);
		}
	};

	const handleRepositoryChanged = () => {
		setSelectedPath(null);
		setSelectedDiffPath(null);
		setHistoricalDiff(null);
		setSourceAutoOpenRequest(null);
		setIsViewerDirty(false);
		setViewerRevision((current) => current + 1);
	};

	const handleDiscardAndNavigate = () => {
		if (navigationBlocker.status !== 'blocked') {
			return;
		}
		setIsViewerDirty(false);
		navigationBlocker.proceed();
	};

	/** Going back or forward to the tab of another test opens that test in the editor. */
	if (activeTestPath !== syncedTestPath) {
		setSyncedTestPath(activeTestPath);
		if (activeTestPath) {
			openedTestTabs.openTab(activeTestPath);
			if (activeTestPath !== editorTestPath) {
				showFile(activeTestPath);
			}
		}
	}

	return (
		<div className='flex flex-col flex-1 overflow-hidden'>
			<ResizablePanelGroup
				orientation='horizontal'
				className='flex-1 min-h-0'
				defaultLayout={defaultLayout ?? { tree: 1.1, viewer: 5 }}
				onLayoutChanged={onLayoutChanged}
			>
				<ResizablePanel id='tree' minSize={180}>
					<div className='flex h-full flex-col overflow-hidden bg-card'>
						{fileTree.isLoading ? (
							<div className='flex items-center justify-center h-32'>
								<Spinner />
							</div>
						) : fileTree.isError ? (
							<div className='flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2'>
								<p>Failed to load files</p>
								<Button variant='outline' size='sm' onClick={() => fileTree.refetch()}>
									Retry
								</Button>
							</div>
						) : (
							<>
								<div className='min-h-40 flex-1 overflow-hidden'>
									<FileTree
										entries={fileTree.data?.entries ?? []}
										selectedPath={historicalDiff?.path ?? selectedDiffPath ?? selectedPath}
										onSelectFile={handleSelectFile}
										search={search}
										onSearchChange={setSearch}
										isContentSearchEnabled={isContentSearchEnabled}
										onContentSearchEnabledChange={setIsContentSearchEnabled}
										contentMatches={contentMatches}
										isContentSearchPending={isContentSearchPending}
										contentSearchFailed={shouldSearchContent && contentSearch.isError}
										contentSearchTruncated={
											isLiveContentSearchEligible &&
											shouldSearchContent &&
											!isContentSearchPending &&
											!contentSearch.isPlaceholderData &&
											contentSearch.data?.truncated === true
										}
									/>
								</div>
								<ContextGitPanel
									selectedDiffPath={selectedDiffPath}
									hasUnsavedFileChanges={isViewerDirty}
									onViewDiff={handleViewDiff}
									onCommitted={handleChangesCommitted}
									onDiscarded={handleLocalChangeDiscarded}
									onDiscardAll={handleAllLocalChangesDiscarded}
									onRepositoryChanged={handleRepositoryChanged}
									onOpenTests={openTestSuite}
								/>
							</>
						)}
					</div>
				</ResizablePanel>

				<ResizableSeparator />

				<ResizablePanel id='viewer' minSize={300}>
					<TestDrawerLayout
						testTabs={openedTestTabs.testPaths}
						activeTestPath={activeTestPath}
						activeTestFile={activeTestFile}
						selectedRunId={testDrawerRun ?? null}
						openRequestId={testDrawerOpenRequestId}
						onSelectTab={selectTestTab}
						onCloseTab={closeTestTab}
						onSelectRun={selectTestRun}
						onOpenTest={(path) => requestViewerTarget({ type: 'file', path, openSource: false })}
					>
						<div className='h-full bg-background'>
							{historicalDiff ? (
								<ContextFileDiff
									path={historicalDiff.path}
									range={{ from: historicalDiff.from, to: historicalDiff.to }}
								/>
							) : selectedDiffPath ? (
								<ContextFileDiff path={selectedDiffPath} />
							) : (
								<FileViewer
									key={`${selectedPath ?? 'empty'}:${viewerRevision}`}
									filePath={selectedPath}
									content={fileContent.data?.content}
									hash={fileContent.data?.hash}
									isLoading={fileContent.isLoading && fileContent.fetchStatus !== 'idle'}
									isError={fileContent.isError && !fileContent.data}
									isEditable={fileContent.data?.isEditable === true}
									editabilityGuidance={fileContent.data?.guidance ?? null}
									searchQuery={shouldSearchContent ? debouncedSearch : ''}
									sourceAutoOpenRequestId={
										sourceAutoOpenRequest?.path === selectedPath ? sourceAutoOpenRequest.id : null
									}
									onDirtyChange={setIsViewerDirty}
									onOpenGuidancePath={(path, kind) => {
										if (kind === 'route') {
											void navigate({ to: path });
											return;
										}
										requestViewerTarget({ type: 'file', path, openSource: false });
									}}
									onReload={async () => {
										const result = await fileContent.refetch();
										if (result.error) {
											throw result.error;
										}
										return result.data;
									}}
									rulesPreviewGroups={rulesPreviewGroupsState}
									onDraftChange={handleEditorDraftChange}
								/>
							)}
						</div>
					</TestDrawerLayout>
				</ResizablePanel>
			</ResizablePanelGroup>
			<DiscardChangesDialog
				open={pendingViewerTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingViewerTarget(null);
					}
				}}
				onDiscard={handleDiscardAndChangeView}
			/>
			<DiscardChangesDialog
				open={navigationBlocker.status === 'blocked'}
				onOpenChange={(open) => {
					if (!open && navigationBlocker.status === 'blocked') {
						navigationBlocker.reset();
					}
				}}
				onDiscard={handleDiscardAndNavigate}
			/>
		</div>
	);
}

function DiscardChangesDialog({
	open,
	onOpenChange,
	onDiscard,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDiscard: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
					<AlertDialogDescription>
						Continuing will discard the changes you made to this file.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep editing</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						onClick={(event) => {
							event.preventDefault();
							onDiscard();
						}}
					>
						Discard changes
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
