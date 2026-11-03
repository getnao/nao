import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, History } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type {
	DraftContext,
	LatestTestOutcome,
	TestComparisonRow,
	TestDefinition,
	TestModelOutcome,
	TestRunSummary,
	TestRunWithResults,
	TestSuiteListing,
} from '@/components/settings/test-run-types';
import type { TestResultFilter } from '@/components/settings/test-result-filter';
import type { SuiteRunScope } from '@/components/settings/test-run-actions';
import {
	ComparisonChangeBadge,
	ContextChangeItem,
	DraftContextWarnings,
	VariantOutcomeCell,
} from '@/components/settings/test-draft-comparison';
import {
	listTestsWhereModelsDisagree,
	ModelChangesChart,
	ModelDot,
	ModelLeaderboard,
	RunStatStrip,
	summarizeTestMetrics,
	TestModelMatrix,
} from '@/components/settings/test-model-results';
import {
	formatDuration,
	formatPassRate,
	formatUnitCost,
	getContextChanges,
	getTestModelColorAt,
	isActiveRun,
	testModelKey,
	toExplorerTestPath,
} from '@/components/settings/test-run-types';
import { matchesResultFilter, TestResultFilterPills } from '@/components/settings/test-result-filter';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface RunTest {
	testPath: string;
	testName: string;
	outcome: { passed: number; total: number; modelsDisagree: boolean };
	failure: string | null;
	comparison: TestComparisonRow | null;
}

type TestMetrics = ReturnType<typeof summarizeTestMetrics>;

const ACTIVE_RUN_REFETCH_MS = 2_000;
const MAX_LISTED_RUNS = 10;
const MAX_LISTED_CHANGES = 4;

/** The tests picked in the suite, which the Run button of the drawer runs. */
export interface SuiteSelection {
	selectedPaths: Set<string>;
	onSelectedPathsChange: (paths: Set<string>) => void;
	selectedTags: string[];
	onSelectedTagsChange: (tags: string[]) => void;
}

interface TestSuitePanelProps {
	draft: DraftContext | null;
	runs: TestRunSummary[] | undefined;
	/** The run opened next to the list of runs, or `null` to list the tests. */
	selectedRunId: string | null;
	selection: SuiteSelection;
	onSelectRun: (runId: string | null) => void;
	onOpenTest: (explorerPath: string) => void;
}

/** Lists the tests and the latest runs of the suite, with the results of the run picked in that list. */
export function TestSuitePanel({
	draft,
	runs,
	selectedRunId,
	selection,
	onSelectRun,
	onOpenTest,
}: TestSuitePanelProps) {
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const openedRun = useQuery({
		...trpc.testRun.getRun.queryOptions({ runId: selectedRunId ?? '' }),
		enabled: selectedRunId !== null,
		refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const contextChanges = getContextChanges(draft);

	return (
		<div className='flex h-full min-h-0 flex-col'>
			{draft && contextChanges.length > 0 && <ContextChangesNotice draft={draft} />}

			<div className='flex min-h-0 flex-1'>
				<nav className='flex w-56 shrink-0 flex-col overflow-y-auto border-r text-xs' aria-label='Test runs'>
					<span className='px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase'>
						Recent runs
					</span>
					{runs?.length === 0 && <span className='px-3 py-1 text-muted-foreground'>No run yet.</span>}
					{runs?.slice(0, MAX_LISTED_RUNS).map((run) => (
						<NavItem key={run.id} isSelected={selectedRunId === run.id} onClick={() => onSelectRun(run.id)}>
							<RunStatusIcon run={run} className='mt-px self-start' />
							<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
								<span className='truncate font-medium text-foreground'>{summarizeRun(run)}</span>
								<span className='truncate text-muted-foreground'>
									{describeRunScope(run)} · {run.triggeredByName ? `${run.triggeredByName} · ` : ''}
									{getTimeAgo(new Date(run.createdAt).getTime()).humanReadable}
								</span>
							</span>
						</NavItem>
					))}
				</nav>

				<div className='min-w-0 flex-1 overflow-y-auto'>
					{selectedRunId === null ? (
						<SuiteTests
							suite={suite.data}
							isLoading={suite.isLoading}
							selection={selection}
							onOpenTest={onOpenTest}
						/>
					) : openedRun.isLoading ? (
						<div className='flex h-full items-center justify-center'>
							<Spinner />
						</div>
					) : openedRun.data ? (
						<RunTests key={openedRun.data.id} run={openedRun.data} onOpenTest={onOpenTest} />
					) : (
						<Empty className='h-full'>Could not open this run: {openedRun.error?.message}</Empty>
					)}
				</div>
			</div>
		</div>
	);
}

/** What the drawer's Run button runs: the picked tests, else those of the picked tags, else the whole suite. */
export function getSuiteRunScope(tests: TestDefinition[], selection: SuiteSelection): SuiteRunScope {
	if (selection.selectedPaths.size > 0) {
		return {
			paths: [...selection.selectedPaths],
			testCount: selection.selectedPaths.size,
			label: `${selection.selectedPaths.size} selected`,
		};
	}
	const visibleTests = filterByTags(tests, selection.selectedTags);
	if (visibleTests.length < tests.length) {
		return {
			paths: visibleTests.map((test) => test.path),
			testCount: visibleTests.length,
			label: pluralize(visibleTests.length, 'test'),
		};
	}
	return { paths: undefined, testCount: tests.length, label: pluralize(tests.length, 'test') };
}

function ContextChangesNotice({ draft }: { draft: DraftContext }) {
	const contextChanges = getContextChanges(draft);
	return (
		<div className='flex shrink-0 flex-col gap-1.5 border-b bg-primary/[0.03] px-3 py-1.5 text-xs text-muted-foreground'>
			<span className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5'>
				<span>
					You changed {pluralize(contextChanges.length, 'context file')}
					{draft.branch && (
						<>
							{' '}
							on <span className='font-mono text-foreground'>{draft.branch}</span>
						</>
					)}
					:
				</span>
				{contextChanges.slice(0, MAX_LISTED_CHANGES).map((change) => (
					<ContextChangeItem key={change.path} change={change} />
				))}
				{contextChanges.length > MAX_LISTED_CHANGES && (
					<span>+{contextChanges.length - MAX_LISTED_CHANGES} more</span>
				)}
			</span>
			<DraftContextWarnings draft={draft} />
		</div>
	);
}

function NavItem({ isSelected, onClick, children }: { isSelected: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type='button'
			aria-current={isSelected ? 'true' : undefined}
			onClick={onClick}
			className={cn(
				'flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-left transition-colors hover:bg-accent/50',
				isSelected && 'bg-accent',
			)}
		>
			{children}
		</button>
	);
}

function SuiteTests({
	suite,
	isLoading,
	selection,
	onOpenTest,
}: {
	suite: TestSuiteListing | undefined;
	isLoading: boolean;
	selection: SuiteSelection;
	onOpenTest: (explorerPath: string) => void;
}) {
	if (isLoading) {
		return (
			<div className='flex h-full items-center justify-center'>
				<Spinner />
			</div>
		);
	}
	if (!suite) {
		return <Empty className='h-full'>Could not load the tests.</Empty>;
	}
	if (suite.tests.length === 0 && suite.invalidFiles.length === 0) {
		return (
			<Empty className='h-full whitespace-normal'>
				No tests yet. Add YAML files with a <code className='font-mono'>prompt</code> and a reference{' '}
				<code className='font-mono'>sql</code> to the <code className='font-mono'>tests/</code> folder.
			</Empty>
		);
	}
	const visibleTests = filterByTags(suite.tests, selection.selectedTags);
	return (
		<div className='flex flex-col text-xs'>
			<SuiteTestsHeader tests={suite.tests} visibleTests={visibleTests} selection={selection} />
			<ul className='flex flex-col'>
				{suite.settings.errors.map((error) => (
					<li key={error} className='flex items-start gap-2 border-b px-3 py-2 text-destructive'>
						<CircleAlert className='mt-px size-3.5 shrink-0' />
						<span className='font-mono whitespace-pre-wrap'>nao_config.yaml: {error}</span>
					</li>
				))}
				{suite.invalidFiles.map((file) => (
					<TestRow
						key={file.path}
						icon={<CircleAlert className='size-3.5 shrink-0 text-destructive' />}
						name={file.path}
						path={file.path}
						detail={
							<span className='max-w-80 truncate text-destructive' title={file.error}>
								Invalid: {file.error}
							</span>
						}
						onOpen={onOpenTest}
					/>
				))}
				{visibleTests.map((test) => (
					<SuiteTestRow
						key={test.path}
						test={test}
						outcome={suite.latestOutcomes[test.path]}
						isSelected={selection.selectedPaths.has(test.path)}
						onSelectedChange={(isSelected) => {
							const next = new Set(selection.selectedPaths);
							if (isSelected) {
								next.add(test.path);
							} else {
								next.delete(test.path);
							}
							selection.onSelectedPathsChange(next);
						}}
						onOpen={onOpenTest}
					/>
				))}
			</ul>
		</div>
	);
}

/** Picks every shown test at once, and narrows the tests to some tags. */
function SuiteTestsHeader({
	tests,
	visibleTests,
	selection,
}: {
	tests: TestDefinition[];
	visibleTests: TestDefinition[];
	selection: SuiteSelection;
}) {
	const tags = [...new Set(tests.flatMap((test) => test.tags))].sort();
	const selectedCount = selection.selectedPaths.size;
	const allSelected = visibleTests.length > 0 && visibleTests.every((test) => selection.selectedPaths.has(test.path));

	const toggleTag = (tag: string) => {
		const selectedTags = selection.selectedTags.includes(tag)
			? selection.selectedTags.filter((selected) => selected !== tag)
			: [...selection.selectedTags, tag];
		selection.onSelectedTagsChange(selectedTags);
		selection.onSelectedPathsChange(new Set());
	};

	return (
		<div className='flex min-h-9 items-center gap-2.5 border-b px-3 py-1.5 text-muted-foreground'>
			<Checkbox
				aria-label='Select the shown tests'
				checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
				onCheckedChange={() =>
					selection.onSelectedPathsChange(
						allSelected ? new Set() : new Set(visibleTests.map((test) => test.path)),
					)
				}
			/>
			<span className={cn(selectedCount > 0 && 'font-medium text-foreground')}>
				{selectedCount > 0 ? `${selectedCount} selected` : pluralize(visibleTests.length, 'test')}
			</span>
			{tags.length > 0 && (
				<div className='flex min-w-0 flex-wrap items-center gap-1' aria-label='Filter by tag'>
					{tags.map((tag) => (
						<Badge
							key={tag}
							variant={selection.selectedTags.includes(tag) ? 'default' : 'outline'}
							className='h-5 text-[11px]'
							asChild
						>
							<button
								type='button'
								aria-pressed={selection.selectedTags.includes(tag)}
								onClick={() => toggleTag(tag)}
								className='cursor-pointer'
							>
								{tag}
							</button>
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

function SuiteTestRow({
	test,
	outcome,
	isSelected,
	onSelectedChange,
	onOpen,
}: {
	test: TestDefinition;
	outcome: LatestTestOutcome | undefined;
	isSelected: boolean;
	onSelectedChange: (isSelected: boolean) => void;
	onOpen: (explorerPath: string) => void;
}) {
	const checkbox = (
		<Checkbox
			aria-label={`Select ${test.name}`}
			checked={isSelected}
			onCheckedChange={(checked) => onSelectedChange(checked === true)}
		/>
	);
	if (!outcome || outcome.totalAttempts === 0) {
		return (
			<TestRow
				leading={checkbox}
				icon={<CircleDashed className='size-3.5 shrink-0 text-muted-foreground' />}
				name={test.name}
				path={test.path}
				detail={<span className='text-muted-foreground'>Never run</span>}
				onOpen={onOpen}
			/>
		);
	}
	return (
		<TestRow
			leading={checkbox}
			icon={
				<OutcomeIcon
					passed={outcome.passedAttempts}
					total={outcome.totalAttempts}
					className={cn(outcome.isOutdated && 'opacity-60')}
				/>
			}
			name={test.name}
			path={test.path}
			detail={
				<span
					className='flex items-center gap-3 text-muted-foreground'
					title={outcome.isOutdated ? 'The test changed after this run' : undefined}
				>
					{outcome.models.length > 1 ? (
						<ModelOutcomes models={outcome.models} />
					) : (
						outcome.totalAttempts > 1 && `${outcome.passedAttempts}/${outcome.totalAttempts} passed`
					)}
					<span className='flex items-center gap-1'>
						{outcome.isOutdated && <History className='size-3 shrink-0' />}
						{getTimeAgo(new Date(outcome.runCreatedAt).getTime()).humanReadable}
					</span>
				</span>
			}
			onOpen={onOpen}
		/>
	);
}

/** The latest outcome of a test on each model of the run that last tried it. */
function ModelOutcomes({ models }: { models: TestModelOutcome[] }) {
	return (
		<span className='flex items-center gap-2.5'>
			{models.map((model) => (
				<span
					key={testModelKey(model)}
					className='flex items-center gap-1'
					title={`${model.modelId}: ${model.passedAttempts}/${model.totalAttempts} passed`}
				>
					<ModelDot color={getTestModelColorAt(model.runIndex)} />
					<OutcomeIcon passed={model.passedAttempts} total={model.totalAttempts} className='size-3' />
				</span>
			))}
		</span>
	);
}

function RunTests({ run, onOpenTest }: { run: TestRunWithResults; onOpenTest: (explorerPath: string) => void }) {
	const [filter, setFilter] = useState<TestResultFilter>('all');
	const isActive = isActiveRun(run);
	const hasSeveralModels = run.models.length > 1;
	const tests = listRunTests(run);
	const visibleTests = tests.filter((test) => matchesResultFilter(test.outcome, filter));
	const openTest = (testPath: string) => onOpenTest(toExplorerTestPath(testPath));
	return (
		<div className='flex flex-col text-xs'>
			<div className='flex items-center gap-3 border-b px-3 py-1.5 text-muted-foreground'>
				<TestResultFilterPills
					outcomes={tests.map((test) => test.outcome)}
					filter={filter}
					onChange={setFilter}
					hasSeveralModels={hasSeveralModels && !run.comparison}
				/>
				<RunDescription run={run} />
			</div>
			<RunModelsOverview run={run} />
			{hasSeveralModels && !run.comparison ? (
				<TestModelMatrix
					run={run}
					testPaths={visibleTests.map((test) => test.testPath)}
					onOpenTest={openTest}
				/>
			) : (
				<RunTestList run={run} tests={visibleTests} onOpenTest={onOpenTest} />
			)}
			{tests.length === 0 ? (
				<Empty className='py-6'>{isActive ? 'Waiting for the first results…' : 'No results recorded.'}</Empty>
			) : (
				visibleTests.length === 0 && <Empty className='py-6'>No test matches this filter.</Empty>
			)}
		</div>
	);
}

/**
 * How the models of a run did: a leaderboard when several models ran, the chart of what the user's changes did to
 * each model for a comparison of several models, else the stat strip of the single model.
 */
function RunModelsOverview({ run }: { run: TestRunWithResults }) {
	if (run.modelSummaries.length === 0) {
		return null;
	}
	if (run.comparison) {
		if (run.models.length > 1) {
			return <ModelChangesChart run={run} />;
		}
		const production = run.modelSummaries.find((summary) => summary.contextVariant === 'production') ?? null;
		const draft = run.modelSummaries.find((summary) => summary.contextVariant === 'draft');
		return draft ? (
			<RunStatStrip
				summary={draft}
				baseline={production}
				baselineLabel='With your changes, compared with production'
			/>
		) : null;
	}
	if (run.models.length > 1) {
		return <ModelLeaderboard run={run} summaries={run.modelSummaries} />;
	}
	const [summary] = run.modelSummaries;
	const previous = run.previousModelSummaries.at(0);
	return (
		<RunStatStrip
			summary={summary}
			baseline={previous?.summary ?? null}
			baselineLabel={
				previous
					? `Compared with the previous run of ${summary.modelId} on these tests, ${getTimeAgo(new Date(previous.runCreatedAt).getTime()).humanReadable}`
					: null
			}
		/>
	);
}

function RunTestList({
	run,
	tests,
	onOpenTest,
}: {
	run: TestRunWithResults;
	tests: RunTest[];
	onOpenTest: (explorerPath: string) => void;
}) {
	const isActive = isActiveRun(run);
	const metrics = run.comparison ? null : summarizeTestMetrics(run.results);
	return (
		<ul className='flex flex-col'>
			{metrics && tests.length > 0 && (
				<li className='flex justify-end border-b px-3 py-1 text-[11px] text-muted-foreground'>
					<MetricColumns cost='$ / question' toolCalls='Tool calls' duration='Time' />
				</li>
			)}
			{tests.map((test) => (
				<TestRow
					key={test.testPath}
					icon={<OutcomeIcon {...test.outcome} isWaiting={isActive} />}
					name={test.testName}
					path={test.testPath}
					detail={
						test.comparison ? (
							<ComparisonDetail
								comparison={test.comparison}
								attemptsPerVariant={run.models.length * run.attempts}
								isActive={isActive}
							/>
						) : (
							<span className='flex items-center gap-4'>
								<AttemptsDetail {...test.outcome} failure={test.failure} />
								{metrics && <TestMetricColumns metrics={metrics} testPath={test.testPath} />}
							</span>
						)
					}
					onOpen={onOpenTest}
				/>
			))}
		</ul>
	);
}

function TestMetricColumns({ metrics, testPath }: { metrics: TestMetrics; testPath: string }) {
	const testMetrics = metrics.get(testPath);
	return (
		<MetricColumns
			cost={formatUnitCost(testMetrics?.costPerQuestion)}
			toolCalls={testMetrics?.toolCalls === null || !testMetrics ? '—' : testMetrics.toolCalls.toFixed(0)}
			duration={formatDuration(testMetrics?.durationMs)}
		/>
	);
}

function MetricColumns({ cost, toolCalls, duration }: { cost: string; toolCalls: string; duration: string }) {
	return (
		<span className='flex shrink-0 text-muted-foreground tabular-nums'>
			<span className='w-20 text-right'>{cost}</span>
			<span className='w-16 text-right'>{toolCalls}</span>
			<span className='w-14 text-right'>{duration}</span>
		</span>
	);
}

function RunDescription({ run }: { run: TestRunWithResults }) {
	const models = run.models.length > 1 ? `${run.models.length} models` : (run.models[0]?.modelId ?? '');
	return (
		<span className='min-w-0 flex-1 truncate text-right'>
			{isActiveRun(run) && `Running ${run.completedAttempts}/${run.totalAttempts} · `}
			{run.comparison &&
				`Production ${formatPassRate(run.comparison.production.passed, run.comparison.production.total)} → your changes ${formatPassRate(run.comparison.draft.passed, run.comparison.draft.total)} · `}
			{models}
			{run.attempts > 1 && ` × ${pluralize(run.attempts, 'attempt')}`}
			{run.errorMessage && <span className='text-destructive'> · {run.errorMessage}</span>}
		</span>
	);
}

function ComparisonDetail({
	comparison,
	attemptsPerVariant,
	isActive,
}: {
	comparison: TestComparisonRow;
	attemptsPerVariant: number;
	isActive: boolean;
}) {
	return (
		<span className='flex items-center gap-3'>
			<span className='flex items-center gap-1.5'>
				<span className='text-muted-foreground'>Production</span>
				<VariantOutcomeCell outcome={comparison.production} attemptsPerVariant={attemptsPerVariant} />
			</span>
			<span className='flex items-center gap-1.5'>
				<span className='text-muted-foreground'>Yours</span>
				<VariantOutcomeCell outcome={comparison.draft} attemptsPerVariant={attemptsPerVariant} />
			</span>
			<ComparisonChangeBadge change={comparison.change} isActive={isActive} />
		</span>
	);
}

function AttemptsDetail({ passed, total, failure }: { passed: number; total: number; failure: string | null }) {
	const reason = passed < total ? failure : null;
	return (
		<span className='flex min-w-0 items-center gap-1 text-muted-foreground'>
			{total > 1 && (
				<span className='shrink-0'>
					{passed}/{total} passed{reason && ' ·'}
				</span>
			)}
			{reason && (
				<span className='max-w-80 truncate text-destructive' title={reason}>
					{reason}
				</span>
			)}
		</span>
	);
}

function TestRow({
	leading,
	icon,
	name,
	path,
	detail,
	onOpen,
}: {
	/** Shown before the row, outside the button that opens the test. */
	leading?: ReactNode;
	icon: ReactNode;
	name: string;
	path: string;
	detail: ReactNode;
	onOpen: (explorerPath: string) => void;
}) {
	return (
		<li className='flex items-center border-b'>
			{leading && <span className='flex shrink-0 items-center pl-3'>{leading}</span>}
			<button
				type='button'
				onClick={() => onOpen(toExplorerTestPath(path))}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent/50'
				title='Open this test'
			>
				{icon}
				<span className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate font-medium text-foreground'>{name}</span>
					<span className='truncate font-mono text-[11px] text-muted-foreground'>tests/{path}</span>
				</span>
				<span className='flex min-w-0 shrink-0 items-center'>{detail}</span>
			</button>
		</li>
	);
}

/** The outcome of a test at a glance: passed, failed, flaky, or still waiting for its attempts. */
function OutcomeIcon({
	passed,
	total,
	isWaiting = false,
	className,
}: {
	passed: number;
	total: number;
	isWaiting?: boolean;
	className?: string;
}) {
	if (total === 0) {
		return isWaiting ? (
			<Spinner className={cn('size-3.5 shrink-0', className)} />
		) : (
			<CircleMinus className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />
		);
	}
	const Icon = passed === total ? CircleCheck : passed === 0 ? CircleX : CircleDashed;
	return (
		<Icon
			aria-label={passed === total ? 'Passed' : passed === 0 ? 'Failed' : 'Flaky'}
			className={cn(
				'size-3.5 shrink-0',
				passed === total
					? 'text-green-600 dark:text-green-500'
					: passed === 0
						? 'text-destructive'
						: 'text-amber-600 dark:text-amber-500',
				className,
			)}
		/>
	);
}

function RunStatusIcon({ run, className }: { run: TestRunSummary; className?: string }) {
	if (isActiveRun(run)) {
		return <Spinner className={cn('size-3.5 shrink-0', className)} />;
	}
	if (run.status !== 'completed') {
		return <CircleMinus className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />;
	}
	return (
		<OutcomeIcon
			passed={run.variantTotals?.draft.passed ?? run.passedAttempts}
			total={run.variantTotals?.draft.total ?? run.totalAttempts}
			className={className}
		/>
	);
}

function summarizeRun(run: TestRunSummary): string {
	if (isActiveRun(run)) {
		return `Running ${run.completedAttempts}/${run.totalAttempts}`;
	}
	if (run.status !== 'completed') {
		return `Run ${run.status}`;
	}
	if (run.variantTotals) {
		const { production, draft } = run.variantTotals;
		return `Production ${formatPassRate(production.passed, production.total)} → yours ${formatPassRate(draft.passed, draft.total)}`;
	}
	if (run.modelTotals && run.modelTotals.length > 1) {
		const bestRate = Math.max(
			...run.modelTotals.map((totals) => (totals.total ? totals.passed / totals.total : 0)),
		);
		return `${run.models.length} models · best ${Math.round(bestRate * 100)}%`;
	}
	return `${formatPassRate(run.passedAttempts, run.totalAttempts)} passed`;
}

function describeRunScope(run: TestRunSummary): string {
	const testCount = run.selection?.length ?? 0;
	const scope = testCount === 1 ? (run.selection?.[0] ?? '') : pluralize(testCount, 'test');
	return run.trigger === 'comparison' ? `Compared ${scope}` : scope;
}

/** The tests of a run with their outcome: with the user's changes for a comparison, else over all their attempts. */
function listRunTests(run: TestRunWithResults): RunTest[] {
	if (run.comparison) {
		return run.comparison.tests.map((test) => ({
			testPath: test.testPath,
			testName: test.testName,
			outcome: { ...test.draft, modelsDisagree: false },
			failure: null,
			comparison: test,
		}));
	}
	const disagreeing = run.models.length > 1 ? listTestsWhereModelsDisagree(run) : new Set<string>();
	return groupResultsByTest(run.results).map(({ passed, total, ...test }) => ({
		...test,
		outcome: { passed, total, modelsDisagree: disagreeing.has(test.testPath) },
		comparison: null,
	}));
}

function groupResultsByTest(results: TestRunWithResults['results']) {
	const tests = new Map<
		string,
		{ testPath: string; testName: string; passed: number; total: number; failure: string | null }
	>();
	for (const result of results) {
		const test = tests.get(result.testPath) ?? {
			testPath: result.testPath,
			testName: result.testName,
			passed: 0,
			total: 0,
			failure: null,
		};
		test.total++;
		test.passed += result.passed ? 1 : 0;
		test.failure ??= result.passed ? null : (result.errorMessage ?? result.message);
		tests.set(result.testPath, test);
	}
	return [...tests.values()];
}

function filterByTags(tests: TestDefinition[], tags: string[]): TestDefinition[] {
	if (tags.length === 0) {
		return tests;
	}
	return tests.filter((test) => test.tags.some((tag) => tags.includes(tag)));
}

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
