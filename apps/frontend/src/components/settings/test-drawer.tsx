import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import type { CSSProperties, ReactNode, Ref, WheelEvent } from 'react';

import type { TestDefinition, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { RUNS_COLUMN_WIDTH_CLASS } from '@/components/settings/test-drawer-layout';
import { SuiteRunActions, TestFileRunActions } from '@/components/settings/test-run-actions';
import { isActiveRun, toExplorerTestPath } from '@/components/settings/test-run-types';
import { getSuiteRunScope, TestSuitePanel } from '@/components/settings/test-suite-panel';
import { TestTabRunButton } from '@/components/settings/test-tab-run-button';
import { TestWorkbench } from '@/components/settings/test-workbench';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTestFileValidation } from '@/hooks/use-test-file-validation';
import { useTestRunSettings } from '@/hooks/use-test-run-settings';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const DRAWER_BAR_HEIGHT = 32;
const DRAWER_MIN_HEIGHT = 160;
const DRAWER_OPENED_SIZE = '45%';
const ACTIVE_RUN_REFETCH_MS = 3_000;
const DRAWER_ANIMATION_MS = 200;
const NO_TESTS: TestDefinition[] = [];
const TAB_DRAG_ACTIVATION_DISTANCE = 4;

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
	onSelectTab: (testPath: string | null) => void;
	onCloseTab: (testPath: string) => void;
	/** Moves a test tab to the place of the tab it was dropped on. */
	onMoveTab: (testPath: string, targetPath: string) => void;
	onSelectRun: (runId: string | null) => void;
	onOpenTest: (explorerPath: string) => void;
}

/** Puts the editor above a drawer, like a terminal panel, that runs the tests and shows their results. */
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
	const selection = {
		selectedPaths,
		onSelectedPathsChange: setSelectedPaths,
		selectedTags,
		onSelectedTagsChange: setSelectedTags,
	};
	const shownTestFile = activeTestPath ? activeTestFile : null;
	const validation = useTestFileValidation(shownTestFile);
	const isPanelReadyRef = useRef(false);
	const shouldOpenWhenReadyRef = useRef(false);
	const hasBeenOpenRef = useRef(false);

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
			onSelectTab(testPath);
		} else if (isOpen && selectedRunId) {
			onSelectRun(null);
			return;
		} else if (isOpen) {
			collapse();
			return;
		}
		open();
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
								className={RUNS_COLUMN_WIDTH_CLASS}
								isActive={isOpen && activeTestPath === null}
								onSelect={() => selectTab(null)}
							/>
							<div
								className='flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden'
								onWheel={scrollTabsHorizontally}
							>
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
						<div className='min-h-0 flex-1'>
							{activeTestPath ? (
								activeTestFile ? (
									<TestWorkbench
										key={activeTestFile.path}
										testFile={activeTestFile}
										validation={validation}
										draft={draft}
										selectedRunId={selectedRunId}
										onSelectRun={onSelectRun}
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
					)}
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

/** The tabs of the opened tests, which can be dragged sideways to change their order, as in an editor. */
function SortableTestTabs({
	testPaths,
	activeTestPath,
	getLabel,
	renderIcon,
	onSelect,
	onClose,
	onMove,
}: {
	testPaths: string[];
	activeTestPath: string | null;
	getLabel: (testPath: string) => string;
	/** Wraps the file icon of a tab, to add actions on it. */
	renderIcon: (testPath: string, icon: ReactNode) => ReactNode;
	onSelect: (testPath: string) => void;
	onClose: (testPath: string) => void;
	onMove: (testPath: string, targetPath: string) => void;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: TAB_DRAG_ACTIVATION_DISTANCE } }),
	);

	const handleDragEnd = ({ active, over }: DragEndEvent) => {
		if (over && active.id !== over.id) {
			onMove(String(active.id), String(over.id));
		}
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[lockToHorizontalAxis]}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={testPaths} strategy={horizontalListSortingStrategy}>
				{testPaths.map((testPath) => (
					<SortableTestTab
						key={testPath}
						testPath={testPath}
						label={getLabel(testPath)}
						isActive={activeTestPath === testPath}
						renderIcon={(icon) => renderIcon(testPath, icon)}
						onSelect={() => onSelect(testPath)}
						onClose={() => onClose(testPath)}
					/>
				))}
			</SortableContext>
		</DndContext>
	);
}

function SortableTestTab({
	testPath,
	label,
	isActive,
	renderIcon,
	onSelect,
	onClose,
}: {
	testPath: string;
	label: string;
	isActive: boolean;
	renderIcon: (icon: ReactNode) => ReactNode;
	onSelect: () => void;
	onClose: () => void;
}) {
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: testPath });

	return (
		<DrawerTab
			label={label}
			title={testPath}
			leading={renderIcon(
				<FileExplorerIcon name={fileName(testPath)} type='file' path={testPath} className='size-3.5' />,
			)}
			isActive={isActive}
			onSelect={onSelect}
			onClose={onClose}
			drag={{
				nodeRef: setNodeRef,
				listeners,
				style: { transform: CSS.Translate.toString(transform), transition },
				isDragging,
			}}
		/>
	);
}

/** Keeps a dragged tab in the bar, moving only sideways. */
const lockToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface DrawerTabDrag {
	nodeRef: (element: HTMLElement | null) => void;
	listeners: ReturnType<typeof useSortable>['listeners'];
	style: CSSProperties;
	isDragging: boolean;
}

/** A tab of the drawer bar, like an editor tab; tabs that can close show a cross and also close on a middle click. */
function DrawerTab({
	label,
	icon,
	leading,
	title,
	className,
	isActive,
	onSelect,
	onClose,
	drag,
}: {
	label: string;
	icon?: ReactNode;
	/** Shown at the start of the tab, outside the button that selects it. */
	leading?: ReactNode;
	title?: string;
	className?: string;
	isActive: boolean;
	onSelect: () => void;
	onClose?: () => void;
	/** Makes the whole tab draggable, to reorder it among the others. */
	drag?: DrawerTabDrag;
}) {
	const tabRef = useRef<HTMLDivElement>(null);
	const setTabRef = useMergedTabRef(tabRef, drag?.nodeRef);

	useEffect(() => {
		if (isActive) {
			tabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		}
	}, [isActive]);

	return (
		<div
			ref={setTabRef}
			style={drag?.style}
			{...drag?.listeners}
			className={cn(
				'group flex h-full shrink-0 items-center border-r transition-colors',
				isActive
					? 'bg-background text-foreground'
					: 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
				drag?.isDragging && 'relative z-10 cursor-grabbing bg-background shadow-md',
				className,
			)}
			onAuxClick={(event) => {
				if (event.button === 1 && onClose) {
					event.preventDefault();
					onClose();
				}
			}}
		>
			{leading}
			<button
				type='button'
				role='tab'
				aria-selected={isActive}
				title={title ?? label}
				onClick={onSelect}
				className={cn(
					'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2',
					leading ? 'pl-0.5' : 'pl-3',
					onClose ? 'pr-1.5' : 'pr-3',
				)}
			>
				{icon}
				<span className='max-w-60 truncate whitespace-nowrap'>{label}</span>
			</button>
			{onClose && (
				<button
					type='button'
					aria-label={`Close ${title}`}
					onClick={onClose}
					className={cn(
						'mr-2 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100',
						isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
					)}
				>
					<X className='size-3' />
				</button>
			)}
		</div>
	);
}

function useMergedTabRef(
	tabRef: { current: HTMLDivElement | null },
	nodeRef: DrawerTabDrag['nodeRef'] | undefined,
): Ref<HTMLDivElement> {
	return useCallback(
		(element: HTMLDivElement | null) => {
			tabRef.current = element;
			nodeRef?.(element);
		},
		[tabRef, nodeRef],
	);
}

/** Lets the mouse wheel scroll the tabs sideways, as in an editor. */
function scrollTabsHorizontally(event: WheelEvent<HTMLDivElement>) {
	if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
		event.currentTarget.scrollLeft += event.deltaY;
	}
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

/**
 * The runs, tests and draft the drawer needs, kept fresh: runs are polled while one is active, and what depends on
 * their outcome or on the saved files is refetched when those change. The draft loads even while the drawer is
 * collapsed, as its bar offers to compare the changes with production.
 */
function useTestDrawerData() {
	const queryClient = useQueryClient();
	const runs = useQuery({
		...trpc.testRun.listRuns.queryOptions(),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const draftContext = useQuery(trpc.testRun.getDraftContext.queryOptions());
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const changedFilesUpdatedAt = useQuery({
		...trpc.contextExplorer.getChangedFiles.queryOptions(),
		enabled: false,
	}).dataUpdatedAt;
	const activeRun = runs.data?.find(isActiveRun);
	const previousActiveRunId = useRef(activeRun?.id);

	useEffect(() => {
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.getDraftContext.queryKey() });
	}, [changedFilesUpdatedAt, queryClient]);

	useEffect(() => {
		if (previousActiveRunId.current && previousActiveRunId.current !== activeRun?.id) {
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.listTests.queryKey() });
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.getTestHistory.queryKey() });
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.getRun.queryKey() });
		}
		previousActiveRunId.current = activeRun?.id;
	}, [activeRun?.id, queryClient]);

	const invalidateRuns = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.listRuns.queryKey() });
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.getTestHistory.queryKey() });
	}, [queryClient]);

	return {
		runs: runs.data,
		activeRun,
		draft: draftContext.data?.status === 'available' ? draftContext.data : null,
		tests: suite.data?.tests,
		invalidateRuns,
	};
}

/** Names a test tab after its test: as it is in the editor when shown, else as saved, else after its file. */
function getTestTabLabel(
	testPath: string,
	tests: TestDefinition[] | undefined,
	shownTestFile: { path: string } | null,
	validation: TestFileValidationState,
): string {
	const editedTestName = shownTestFile?.path === testPath ? validation.validation?.test?.name : undefined;
	const savedTestName = tests?.find((test) => toExplorerTestPath(test.path) === testPath)?.name;
	return editedTestName ?? savedTestName ?? fileName(testPath);
}

function fileName(path: string): string {
	return path.split('/').at(-1) ?? path;
}
