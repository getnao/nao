import { TESTS_FOLDER, toExplorerTestPath } from '@nao/shared/test-paths';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, FileCode, Play, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { TestDefinition } from '@/components/settings/test-run-types';
import type { TestFilters } from '@/components/settings/test-suite-filter-menu';
import { ContextHubSectionIcon } from '@/components/context-hub/context-hub-section-icon';
import { SqlCode } from '@/components/settings/test-attempt-sql';
import { ActiveRunStatus } from '@/components/settings/test-drawer';
import { RunsColumnWidthContext, useRunsColumnWidthState } from '@/components/settings/test-drawer-layout';
import { SuiteRunActions, TestFileRunActions } from '@/components/settings/test-run-actions';
import { NO_TEST_FILTERS } from '@/components/settings/test-suite-filter-menu';
import { getSuiteRunScope, TestSuitePanel } from '@/components/settings/test-suite-panel';
import { TestWorkbench } from '@/components/settings/test-workbench';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { TAB_BAR_HEIGHT } from '@/components/settings/sortable-tabs';
import { useTestDrawerData } from '@/hooks/use-test-drawer-data';
import { useTestFileValidation } from '@/hooks/use-test-file-validation';
import { useTestRunSettings } from '@/hooks/use-test-run-settings';
import { useContextFile } from '@/hooks/use-upstream-context';
import { formatSQLInAnyDialect } from '@/lib/sql-formatter';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const NO_TESTS: TestDefinition[] = [];
const REFERENCE_ROWS_PER_PAGE = 10;

interface ReferenceQueryOutcome {
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
	error: string | null;
}

/** All the tests of the doc view, with their runs, in place of a file: what the drawer of the file tree shows. */
export function ContextHubTestSuite({
	selectedRunId,
	onSelectRun,
	onOpenTest,
}: {
	selectedRunId: string | null;
	onSelectRun: (runId: string | null) => void;
	onOpenTest: (explorerPath: string, runId?: string) => void;
}) {
	const { runs, activeRun, draft, tests, invalidateRuns } = useTestDrawerData();
	const runSettings = useTestRunSettings();
	const runsColumnWidth = useRunsColumnWidthState();
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [filters, setFilters] = useState<TestFilters>(NO_TEST_FILTERS);
	const [search, setSearch] = useState('');
	const selection = {
		selectedPaths,
		onSelectedPathsChange: setSelectedPaths,
		filters,
		onFiltersChange: setFilters,
		search,
		onSearchChange: setSearch,
	};

	const handleRunStarted = (run: { id: string }) => {
		setSelectedPaths(new Set());
		invalidateRuns();
		onSelectRun(run.id);
	};

	return (
		<RunsColumnWidthContext.Provider value={runsColumnWidth}>
			<div className='flex h-full flex-col bg-background'>
				<TestsPageHeader
					trail={
						<button
							type='button'
							className={cn('truncate font-medium', selectedRunId && 'cursor-pointer hover:underline')}
							disabled={!selectedRunId}
							onClick={() => onSelectRun(null)}
						>
							{tests ? `All tests (${tests.length})` : 'All tests'}
						</button>
					}
					actions={
						<>
							{activeRun && <ActiveRunStatus run={activeRun} />}
							<SuiteRunActions
								settings={runSettings}
								draft={draft}
								activeRun={activeRun}
								scope={getSuiteRunScope(tests ?? NO_TESTS, selection)}
								tests={tests ?? NO_TESTS}
								onRunStarted={handleRunStarted}
							/>
						</>
					}
				/>
				<div className='min-h-0 flex-1 overflow-hidden'>
					<TestSuitePanel
						draft={draft}
						runs={runs}
						selectedRunId={selectedRunId}
						selection={selection}
						onSelectRun={onSelectRun}
						onOpenTest={onOpenTest}
					/>
				</div>
			</div>
		</RunsColumnWidthContext.Provider>
	);
}

/** One test of the doc view: what it asks and expects in words, above its runs, rather than its YAML. */
export function ContextHubTestPage({
	testPath,
	selectedRunId,
	onSelectRun,
	onOpenSuite,
	onOpenSuiteRun,
	onEditFile,
}: {
	testPath: string;
	selectedRunId: string | null;
	onSelectRun: (runId: string | null) => void;
	onOpenSuite: () => void;
	onOpenSuiteRun: (runId: string) => void;
	/** Absent for people who only get the doc view. */
	onEditFile?: () => void;
}) {
	const { activeRun, draft, tests, invalidateRuns } = useTestDrawerData();
	const runSettings = useTestRunSettings();
	const runsColumnWidth = useRunsColumnWidthState();
	const savedTest = useContextFile(testPath);
	const content = savedTest.data?.content;
	const testFile = useMemo(() => (content === undefined ? null : { path: testPath, content }), [testPath, content]);
	const validation = useTestFileValidation(testFile);
	const savedDefinition = tests?.find((test) => toExplorerTestPath(test.path) === testPath);
	const definition = validation.validation?.test ?? savedDefinition;

	const handleRunStarted = (run: { id: string }) => {
		invalidateRuns();
		onSelectRun(run.id);
	};

	return (
		<RunsColumnWidthContext.Provider value={runsColumnWidth}>
			<div className='flex h-full flex-col bg-background'>
				<TestsPageHeader
					trail={
						<>
							<button
								type='button'
								className='shrink-0 cursor-pointer hover:underline'
								onClick={onOpenSuite}
							>
								All tests
							</button>
							<ChevronRight className='size-3 shrink-0 text-muted-foreground' />
							<span className='truncate font-medium'>{definition?.name ?? testPath}</span>
						</>
					}
					actions={
						<>
							{activeRun && <ActiveRunStatus run={activeRun} />}
							{onEditFile && (
								<Button
									type='button'
									variant='ghost'
									size='sm'
									className='h-7 gap-1.5 text-xs'
									onClick={onEditFile}
								>
									<FileCode className='size-3.5' />
									Edit the YAML
								</Button>
							)}
							{testFile && (
								<TestFileRunActions
									settings={runSettings}
									draft={draft}
									activeRun={activeRun}
									testFile={testFile}
									validation={validation}
									onRunStarted={handleRunStarted}
								/>
							)}
						</>
					}
				/>
				{savedTest.isError ? (
					<Empty className='flex-1'>Could not load this test.</Empty>
				) : !testFile ? (
					<div className='flex flex-1 items-center justify-center'>
						<Spinner />
					</div>
				) : (
					<>
						{definition && <TestDefinitionSummary test={definition} testFile={testFile} />}
						<div className='min-h-0 flex-1 text-xs'>
							<TestWorkbench
								key={testFile.path}
								testFile={testFile}
								validation={validation}
								draft={draft}
								selectedRunId={selectedRunId}
								onSelectRun={onSelectRun}
								onOpenSuiteRun={onOpenSuiteRun}
								runSettings={runSettings}
								activeRun={activeRun}
								onRunStarted={handleRunStarted}
							/>
						</div>
					</>
				)}
			</div>
		</RunsColumnWidthContext.Provider>
	);
}

function TestsPageHeader({ trail, actions }: { trail: ReactNode; actions: ReactNode }) {
	return (
		<div className='flex shrink-0 items-center gap-2 border-b px-2.5 text-xs' style={{ height: TAB_BAR_HEIGHT }}>
			<ContextHubSectionIcon section='tests' />
			<nav aria-label='Tests' className='flex min-w-0 flex-1 items-center gap-1 text-[13px]'>
				{trail}
			</nav>
			<div className='flex shrink-0 items-center gap-3'>{actions}</div>
		</div>
	);
}

function TestDefinitionSummary({
	test,
	testFile,
}: {
	test: TestDefinition;
	testFile: { path: string; content: string };
}) {
	const referenceQuery = useReferenceQuery(testFile);

	return (
		<section aria-label='Test' className='max-h-[50%] shrink-0 overflow-y-auto border-b'>
			<div className='flex max-w-5xl flex-col gap-4 px-6 py-5'>
				<div className='flex flex-col gap-1.5'>
					<h1 className='text-lg font-semibold'>{test.name}</h1>
					<div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
						{test.owner && (
							<span className='flex items-center gap-1'>
								<User className='size-3' />
								{test.owner}
							</span>
						)}
						{test.tags.map((tag) => (
							<Badge key={tag} variant='outline' className='h-5 px-1.5 font-normal text-muted-foreground'>
								{tag}
							</Badge>
						))}
						<span className='font-mono text-[11px]'>
							{TESTS_FOLDER}/{test.path}
						</span>
					</div>
				</div>
				<div className='grid gap-4 lg:grid-cols-2'>
					<SummaryBlock title='Question asked to the agent'>
						<p className='rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap'>{test.prompt}</p>
					</SummaryBlock>
					<SummaryBlock
						title='Expected answer'
						action={
							test.sql && (
								<Button
									type='button'
									variant='ghost'
									size='sm'
									className='h-6 gap-1 px-1.5 text-xs'
									disabled={referenceQuery.isPending}
									onClick={referenceQuery.run}
								>
									{referenceQuery.isPending ? (
										<Spinner className='size-3' />
									) : (
										<Play className='size-3' />
									)}
									Run query
								</Button>
							)
						}
					>
						{test.sql ? (
							<>
								<p className='text-xs text-muted-foreground'>
									The data of the answer must match the result of this query
									{test.databaseId && (
										<>
											{' '}
											on <span className='font-mono'>{test.databaseId}</span>
										</>
									)}
									.
								</p>
								<div className='text-xs'>
									<SqlCode code={formatSQLInAnyDialect(test.sql)} />
								</div>
							</>
						) : (
							<p className='text-xs text-muted-foreground'>
								No reference query: only the checks below decide whether the agent passes.
							</p>
						)}
					</SummaryBlock>
				</div>
				{referenceQuery.result && <ReferenceQueryResult result={referenceQuery.result} />}
				{test.assertions.length > 0 && (
					<SummaryBlock title='Checks'>
						<ul className='flex flex-col gap-1 text-sm'>
							{test.assertions.map((assertion, index) => (
								<li key={index} className='flex flex-wrap items-center gap-1.5'>
									<span>Calls</span>
									<code className='rounded bg-muted px-1 font-mono text-xs'>{assertion.tool}</code>
									{assertion.min_count > 1 && <span>at least {assertion.min_count} times</span>}
									{assertion.args && <AssertionArgs args={assertion.args} />}
								</li>
							))}
						</ul>
					</SummaryBlock>
				)}
			</div>
		</section>
	);
}

function SummaryBlock({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	return (
		<div className='flex min-w-0 flex-col gap-1.5'>
			<div className='flex h-6 items-center justify-between gap-2'>
				<h2 className='text-[10px] font-medium tracking-wide text-muted-foreground uppercase'>{title}</h2>
				{action}
			</div>
			{children}
		</div>
	);
}

function AssertionArgs({ args }: { args: Record<string, unknown> }) {
	return (
		<>
			<span>with</span>
			{Object.entries(args).map(([name, value]) => (
				<code key={name} className='rounded bg-muted px-1 font-mono text-xs'>
					{name}: {typeof value === 'string' ? value : JSON.stringify(value)}
				</code>
			))}
		</>
	);
}

function ReferenceQueryResult({ result }: { result: ReferenceQueryOutcome }) {
	return (
		<SummaryBlock title='Result of the reference query'>
			{result.error ? (
				<p className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive'>
					{result.error}
				</p>
			) : (
				<div className='overflow-hidden rounded-md border text-xs'>
					<TableDisplay
						data={result.rows}
						columns={result.columns}
						tableContainerClassName='max-h-72 rounded-none border-0 bg-transparent'
						maxRowsBeforePagination={REFERENCE_ROWS_PER_PAGE}
						emptyLabel='The query returned no rows.'
						compactFooter
					/>
					{result.rowCount > result.rows.length && (
						<p className='border-t px-3 py-1.5 text-muted-foreground'>
							Showing the first {result.rows.length} of {result.rowCount} rows.
						</p>
					)}
				</div>
			)}
		</SummaryBlock>
	);
}

/** Runs the reference SQL of the test as shown, and keeps its result only while the test stays the same. */
function useReferenceQuery(testFile: { path: string; content: string }) {
	const mutation = useMutation(trpc.testRun.runReferenceSql.mutationOptions());
	const isCurrent = mutation.variables?.path === testFile.path && mutation.variables.content === testFile.content;
	return {
		result: isCurrent ? toReferenceQueryOutcome(mutation) : null,
		isPending: mutation.isPending,
		run: () => mutation.mutate(testFile),
	};
}

function toReferenceQueryOutcome(mutation: {
	data?: Omit<ReferenceQueryOutcome, 'error'>;
	error: { message: string } | null;
}): ReferenceQueryOutcome | null {
	if (mutation.error) {
		return { columns: [], rows: [], rowCount: 0, error: mutation.error.message };
	}
	return mutation.data ? { ...mutation.data, error: null } : null;
}
