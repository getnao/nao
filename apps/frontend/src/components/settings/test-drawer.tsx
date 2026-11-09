import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import type { ReactNode } from 'react';

import type { TestDefinition, TestRunSummary } from '@/components/settings/test-run-types';
import { RunsColumnWidthContext, useRunsColumnWidthState } from '@/components/settings/test-drawer-layout';
import { DrawerTab, getTestTabLabel, SortableTestTabs } from '@/components/settings/test-drawer-tabs';
import { SuiteRunActions, TestFileRunActions } from '@/components/settings/test-run-actions';
import { getSuiteRunScope, TestSuitePanel } from '@/components/settings/test-suite-panel';
import { TestTabRunButton } from '@/components/settings/test-tab-run-button';
import { TestWorkbench } from '@/components/settings/test-workbench';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTestDrawerData } from '@/hooks/use-test-drawer-data';
import { useTestFileValidation } from '@/hooks/use-test-file-validation';
import { useTestRunSettings } from '@/hooks/use-test-run-settings';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

const DRAWER_BAR_HEIGHT = 32;
const DRAWER_MIN_HEIGHT = 160;
const DRAWER_OPENED_SIZE = '45%';
const DRAWER_ANIMATION_MS = 200;
const NO_TESTS: TestDefinition[] = [];

interface TestDrawerLayoutProps {
	children: ReactNode;
	/** Explorer paths of the tests opened as tabs, after the "All tests" tab. */
	testTabs: string[];
	/** The test whose tab is shown, or `null` for all the tests. */
	activeTestPath: string | null;
	/** That test as it is in the editor, once loaded. */
	activeTestFile: { path: string; content: string } | null;
	/** The run opened in the shown tab, or `null` for its default view. */
	selectedRunId: string | null;
	/** Opens the drawer again whenever it changes, even after the user closed it. */
	openRequestId: number;
	/** Shows a tab, with the run to open in it. */
	onSelectTab: (testPath: string | null, runId?: string) => void;
	onCloseTab: (testPath: string) => void;
	onMoveTab: (testPath: string, targetPath: string) => void;
	onSelectRun: (runId: string | null) => void;
	/** Opens a test, from a run of several tests when given, so its tab shows that run. */
	onOpenTest: (explorerPath: string, runId?: string) => void;
}

export function TestDrawerLayout({
	children,
	testTabs,
	activeTestPath,
	activeTestFile,
	selectedRunId,
	openRequestId,
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onSelectRun,
	onOpenTest,
}: TestDrawerLayoutProps) {
	const panelRef = usePanelRef();
	const [isOpen, setIsOpen] = useState(false);
	const { groupElementRef, isAnimating, animate } = useDrawerAnimation();
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: 'context-explorer-tests',
		storage: localStorage,
	});
	const { runs, activeRun, draft, tests, invalidateRuns } = useTestDrawerData();
	const runSettings = useTestRunSettings();
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [testSearch, setTestSearch] = useState('');
	const selection = {
		selectedPaths,
		onSelectedPathsChange: setSelectedPaths,
		selectedTags,
		onSelectedTagsChange: setSelectedTags,
		search: testSearch,
		onSearchChange: setTestSearch,
	};
	const runsColumnWidth = useRunsColumnWidthState();
	const [suiteRunId, setSuiteRunId] = useState<string | null>(null);
	const shownTestFile = activeTestPath ? activeTestFile : null;
	const validation = useTestFileValidation(shownTestFile);
	const isPanelReadyRef = useRef(false);
	const shouldOpenWhenReadyRef = useRef(false);
	const hasBeenOpenRef = useRef(false);

	/** The "All tests" tab keeps the run opened in it, to show it again when coming back from a test. */
	if (activeTestPath === null && selectedRunId !== suiteRunId) {
		setSuiteRunId(selectedRunId);
	}

	const open = useCallback(() => {
		const panel = panelRef.current;
		if (!panel || !isPanelReadyRef.current) {
			shouldOpenWhenReadyRef.current = true;
			return;
		}
		if (!panel.isCollapsed()) {
			return;
		}
		animate();
		panel.expand();
		if (!hasBeenOpenRef.current) {
			panel.resize(DRAWER_OPENED_SIZE);
		}
	}, [panelRef, animate]);

	const collapse = () => {
		animate();
		panelRef.current?.collapse();
	};

	const handleResize = () => {
		const panel = panelRef.current;
		if (!panel) {
			return;
		}
		isPanelReadyRef.current = true;
		const isCollapsed = panel.isCollapsed();
		hasBeenOpenRef.current ||= !isCollapsed;
		setIsOpen(!isCollapsed);
		if (shouldOpenWhenReadyRef.current) {
			shouldOpenWhenReadyRef.current = false;
			requestAnimationFrame(open);
		}
	};

	const toggle = () => {
		if (!isOpen) {
			open();
		} else {
			collapse();
		}
	};

	useKeyboardShortcuts({ 'toggle-test-drawer': toggle });

	const handleRunStarted = (run: { id: string }) => {
		setSelectedPaths(new Set());
		invalidateRuns();
		onSelectRun(run.id);
	};

	/** Clicking the tab already shown goes back from an opened run to the tab's own view, then closes the drawer. */
	const selectTab = (testPath: string | null) => {
		if (testPath !== activeTestPath) {
			showTab(testPath);
		} else if (isOpen && selectedRunId) {
			onSelectRun(null);
			return;
		} else if (isOpen) {
			collapse();
			return;
		}
		open();
	};

	const showTab = (testPath: string | null) => {
		if (testPath === null && suiteRunId) {
			onSelectTab(null, suiteRunId);
		} else {
			onSelectTab(testPath);
		}
	};

	const openSuiteRun = (runId: string) => {
		onSelectTab(null, runId);
	};

	const selectTabToRun = (testPath: string) => {
		if (testPath !== activeTestPath) {
			onSelectTab(testPath);
		}
	};

	useEffect(() => {
		if (activeTestPath) {
			open();
		}
	}, [activeTestPath, open]);

	useEffect(() => {
		if (selectedRunId) {
			open();
		}
	}, [selectedRunId, open]);

	useEffect(() => {
		if (openRequestId > 0) {
			open();
		}
	}, [openRequestId, open]);

	return (
		<ResizablePanelGroup
			elementRef={groupElementRef}
			orientation='vertical'
			className='h-full motion-safe:[&[data-animating]>[data-panel]]:transition-[flex-grow] motion-safe:[&[data-animating]>[data-panel]]:duration-200 motion-safe:[&[data-animating]>[data-panel]]:ease-out'
			defaultLayout={defaultLayout}
			onLayoutChanged={onLayoutChanged}
		>
			<ResizablePanel id='editor' minSize={120}>
				{children}
			</ResizablePanel>
			<ResizableSeparator />
			<ResizablePanel
				id='tests'
				panelRef={panelRef}
				collapsible
				collapsedSize={DRAWER_BAR_HEIGHT}
				minSize={DRAWER_MIN_HEIGHT}
				defaultSize={DRAWER_BAR_HEIGHT}
				onResize={handleResize}
			>
				<section className='flex h-full flex-col bg-background' aria-label='Tests'>
					<div
						className={cn(
							'flex shrink-0 items-center bg-muted/30 pr-2 text-xs',
							isOpen && 'shadow-[inset_0_-1px_0_var(--border)]',
						)}
						style={{ height: DRAWER_BAR_HEIGHT }}
					>
						<div role='tablist' aria-label='Tests' className='flex h-full min-w-0 flex-1'>
							<DrawerTab
								label={tests ? `All tests (${tests.length})` : 'All tests'}
								leading={
									<SimpleTooltip
										content={`${isOpen ? 'Hide' : 'Show'} the tests (${getShortcutLabel('toggle-test-drawer')})`}
										side='top'
									>
										<Button
											type='button'
											size='icon-sm'
											variant='ghost'
											className='ml-1 size-6'
											onClick={toggle}
											aria-label={isOpen ? 'Hide the tests' : 'Show the tests'}
											aria-expanded={isOpen}
										>
											{isOpen ? (
												<ChevronDown className='size-3.5' />
											) : (
												<ChevronUp className='size-3.5' />
											)}
										</Button>
									</SimpleTooltip>
								}
								width={runsColumnWidth.width}
								isActive={isOpen && activeTestPath === null}
								onSelect={() => selectTab(null)}
							/>
							<SortableTestTabs
								testPaths={testTabs}
								activeTestPath={isOpen ? activeTestPath : null}
								getLabel={(testPath) => getTestTabLabel(testPath, tests, shownTestFile, validation)}
								renderIcon={(testPath, icon) => (
									<TestTabRunButton
										icon={icon}
										testPath={testPath}
										testFile={shownTestFile?.path === testPath ? shownTestFile : null}
										isTestFileInvalid={
											shownTestFile?.path === testPath && !validation.validation?.test
										}
										settings={runSettings}
										draft={draft}
										activeRun={activeRun}
										onStart={() => selectTabToRun(testPath)}
										onRunStarted={handleRunStarted}
									/>
								)}
								onSelect={selectTab}
								onClose={onCloseTab}
								onMove={onMoveTab}
							/>
						</div>
						<div className='ml-2 flex shrink-0 items-center gap-3'>
							{activeRun && <ActiveRunStatus run={activeRun} />}
							{shownTestFile ? (
								<TestFileRunActions
									settings={runSettings}
									draft={draft}
									activeRun={activeRun}
									testFile={shownTestFile}
									validation={validation}
									onRunStarted={handleRunStarted}
								/>
							) : (
								!activeTestPath && (
									<SuiteRunActions
										settings={runSettings}
										draft={draft}
										activeRun={activeRun}
										scope={getSuiteRunScope(tests ?? NO_TESTS, selection)}
										onRunStarted={handleRunStarted}
									/>
								)
							)}
						</div>
					</div>
					{(isOpen || isAnimating) && (
						<RunsColumnWidthContext.Provider value={runsColumnWidth}>
							<div className='min-h-0 flex-1 overflow-hidden'>
								{activeTestPath ? (
									activeTestFile ? (
										<TestWorkbench
											key={activeTestFile.path}
											testFile={activeTestFile}
											validation={validation}
											draft={draft}
											selectedRunId={selectedRunId}
											onSelectRun={onSelectRun}
											onOpenSuiteRun={openSuiteRun}
											runSettings={runSettings}
											activeRun={activeRun}
											onRunStarted={handleRunStarted}
										/>
									) : (
										<div className='flex h-full items-center justify-center'>
											<Spinner />
										</div>
									)
								) : (
									<TestSuitePanel
										draft={draft}
										runs={runs}
										selectedRunId={selectedRunId}
										selection={selection}
										onSelectRun={onSelectRun}
										onOpenTest={onOpenTest}
									/>
								)}
							</div>
						</RunsColumnWidthContext.Provider>
					)}
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

function ActiveRunStatus({ run }: { run: TestRunSummary }) {
	return (
		<span className='flex items-center gap-1.5 text-muted-foreground'>
			<Spinner className='size-3' />
			{run.trigger === 'comparison' ? 'Comparing' : 'Running'} {run.completedAttempts}/{run.totalAttempts}
		</span>
	);
}

/**
 * Animates the panels while the drawer opens or closes, but not while the user drags the separator. The attribute is
 * set on the element right away so the transition applies to the very size change the library makes next.
 */
function useDrawerAnimation() {
	const groupElementRef = useRef<HTMLDivElement>(null);
	const timeoutRef = useRef<number | undefined>(undefined);
	const [isAnimating, setIsAnimating] = useState(false);

	const animate = useCallback(() => {
		groupElementRef.current?.setAttribute('data-animating', '');
		setIsAnimating(true);
		window.clearTimeout(timeoutRef.current);
		timeoutRef.current = window.setTimeout(() => {
			groupElementRef.current?.removeAttribute('data-animating');
			setIsAnimating(false);
		}, DRAWER_ANIMATION_MS);
	}, []);

	useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

	return { groupElementRef, isAnimating, animate };
}
