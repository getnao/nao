import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import type { ReactNode } from 'react';

import type { TestRunSummary } from '@/components/settings/test-run-types';
import { isActiveRun } from '@/components/settings/test-run-types';
import { TestSuitePanel } from '@/components/settings/test-suite-panel';
import { TestWorkbench } from '@/components/settings/test-workbench';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const DRAWER_BAR_HEIGHT = 32;
const DRAWER_MIN_HEIGHT = 160;
const DRAWER_OPENED_SIZE = '45%';
const ACTIVE_RUN_REFETCH_MS = 3_000;

export type TestDrawerTab = 'test' | 'suite';

/** Asks the drawer to open on a tab; a new id opens it again after the user closed it. */
export interface TestDrawerRequest {
	tab: TestDrawerTab;
	id: number;
}

interface TestDrawerLayoutProps {
	children: ReactNode;
	/** Explorer path of the test file open in the editor. */
	testFilePath: string | null;
	/** That test as it is in the editor, once loaded. */
	testFile: { path: string; content: string } | null;
	request: TestDrawerRequest | null;
	onOpenTest: (explorerPath: string) => void;
}

/** Puts the editor above a drawer, like a terminal panel, that runs the tests and shows their results. */
export function TestDrawerLayout({ children, testFilePath, testFile, request, onOpenTest }: TestDrawerLayoutProps) {
	const panelRef = usePanelRef();
	const [isOpen, setIsOpen] = useState(false);
	const [tab, setTab] = useState<TestDrawerTab>('test');
	const activeTab = testFilePath ? tab : 'suite';
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: 'context-explorer-tests',
		storage: localStorage,
	});
	const { runs, activeRun, draft, invalidateRuns } = useTestDrawerData(isOpen);
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
		panel.expand();
		if (!hasBeenOpenRef.current) {
			panel.resize(DRAWER_OPENED_SIZE);
		}
	}, [panelRef]);

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
			panelRef.current?.collapse();
		}
	};

	const selectTab = (nextTab: TestDrawerTab) => {
		setTab(nextTab);
		open();
	};

	useEffect(() => {
		if (testFilePath) {
			setTab('test');
			open();
		}
	}, [testFilePath, open]);

	useEffect(() => {
		if (request) {
			setTab(request.tab);
			open();
		}
	}, [request, open]);

	return (
		<ResizablePanelGroup
			orientation='vertical'
			className='h-full'
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
						className='flex shrink-0 items-center gap-1 bg-muted/30 px-2 text-xs'
						style={{ height: DRAWER_BAR_HEIGHT }}
					>
						<button
							type='button'
							onClick={toggle}
							className='flex cursor-pointer items-center gap-1.5 px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground'
						>
							<FlaskConical className='size-3.5' />
							Tests
						</button>
						<div role='tablist' aria-label='Tests' className='ml-2 flex h-full items-center'>
							{testFilePath && (
								<DrawerTab
									isActive={isOpen && activeTab === 'test'}
									onClick={() => selectTab('test')}
									title={testFilePath}
								>
									{fileName(testFilePath)}
								</DrawerTab>
							)}
							<DrawerTab isActive={isOpen && activeTab === 'suite'} onClick={() => selectTab('suite')}>
								All tests
							</DrawerTab>
						</div>
						<div className='ml-auto flex items-center gap-2'>
							{activeRun && <ActiveRunStatus run={activeRun} />}
							<Button
								type='button'
								size='icon-sm'
								variant='ghost'
								className='size-6'
								onClick={toggle}
								aria-label={isOpen ? 'Hide the tests' : 'Show the tests'}
								aria-expanded={isOpen}
							>
								{isOpen ? <ChevronDown className='size-3.5' /> : <ChevronUp className='size-3.5' />}
							</Button>
						</div>
					</div>
					{isOpen && (
						<div className='min-h-0 flex-1 border-t'>
							{activeTab === 'test' ? (
								testFile ? (
									<TestWorkbench
										key={testFile.path}
										testFile={testFile}
										draft={draft}
										isRunInProgress={!!activeRun}
										onRunStarted={invalidateRuns}
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
									activeRun={activeRun}
									onRunsChanged={invalidateRuns}
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

function DrawerTab({
	isActive,
	onClick,
	title,
	children,
}: {
	isActive: boolean;
	onClick: () => void;
	title?: string;
	children: ReactNode;
}) {
	return (
		<button
			type='button'
			role='tab'
			aria-selected={isActive}
			title={title}
			onClick={onClick}
			className={cn(
				'flex h-full max-w-56 cursor-pointer items-center truncate border-b-2 px-2 transition-colors',
				isActive
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground',
			)}
		>
			<span className='truncate'>{children}</span>
		</button>
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
 * The runs and draft the drawer needs, kept fresh: runs are polled while one is active, and what depends on
 * their outcome or on the saved files is refetched when those change.
 */
function useTestDrawerData(isOpen: boolean) {
	const queryClient = useQueryClient();
	const runs = useQuery({
		...trpc.testRun.listRuns.queryOptions(),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const draftContext = useQuery({ ...trpc.testRun.getDraftContext.queryOptions(), enabled: isOpen });
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
		invalidateRuns,
	};
}

function fileName(path: string): string {
	return path.split('/').at(-1) ?? path;
}
