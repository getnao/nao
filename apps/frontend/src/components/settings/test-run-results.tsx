import { toExplorerTestPath } from '@nao/shared/test-paths';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { ReactNode } from 'react';

import type { TestResultFilter } from '@/components/settings/test-result-filter';
import type { TestComparisonRow, TestResultOutcome, TestRunWithResults } from '@/components/settings/test-run-types';
import { ComparisonChangeBadge, VariantOutcomeCell } from '@/components/settings/test-draft-comparison';
import { PanelHeader } from '@/components/settings/test-drawer-layout';
import { ModelChangesChart } from '@/components/settings/test-model-changes-chart';
import { ModelLeaderboard } from '@/components/settings/test-model-leaderboard';
import { listTestsWhereModelsDisagree, TestModelMatrix } from '@/components/settings/test-model-matrix';
import { matchesResultFilter, TestResultFilterPills } from '@/components/settings/test-result-filter';
import { TestRow } from '@/components/settings/test-row';
import { BranchName, ToneIcon } from '@/components/settings/test-run-labels';
import { RunStatStrip } from '@/components/settings/test-run-stat-strip';
import {
	ACTIVE_RUN_REFETCH_MS,
	average,
	describeTestModels,
	formatCount,
	formatDuration,
	formatPassRate,
	formatUnitCost,
	groupResultsByTest,
	isActiveRun,
} from '@/components/settings/test-run-types';
import { variantTone } from '@/components/settings/test-run-verdict';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { getTimeAgo } from '@/lib/time-ago';
import { trpc } from '@/main';

interface RunTest {
	testPath: string;
	testName: string;
	outcome: { passedAttempts: number; totalAttempts: number; expectedAttempts: number; modelsDisagree: boolean };
	failure: string | null;
	comparison: TestComparisonRow | null;
}

type TestMetrics = ReturnType<typeof summarizeTestMetrics>;

export function TestRunResults({
	runId,
	mainBranch,
	onOpenTest,
}: {
	runId: string;
	mainBranch: string;
	onOpenTest: (explorerPath: string) => void;
}) {
	const openedRun = useQuery({
		...trpc.testRun.getRun.queryOptions({ runId }),
		refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	if (openedRun.isLoading) {
		return (
			<div className='flex h-full items-center justify-center'>
				<Spinner />
			</div>
		);
	}
	if (!openedRun.data) {
		return <Empty className='h-full'>Could not open this run: {openedRun.error?.message}</Empty>;
	}
	return <RunResults run={openedRun.data} mainBranch={mainBranch} onOpenTest={onOpenTest} />;
}

function RunResults({
	run,
	mainBranch,
	onOpenTest,
}: {
	run: TestRunWithResults;
	mainBranch: string;
	onOpenTest: (explorerPath: string) => void;
}) {
	const [filter, setFilter] = useState<TestResultFilter>('all');
	const isActive = isActiveRun(run);
	const hasSeveralModels = run.models.length > 1;
	const tests = listRunTests(run);
	const visibleTests = tests.filter((test) => matchesResultFilter(test.outcome, filter));
	const openTest = (testPath: string) => onOpenTest(toExplorerTestPath(testPath));
	return (
		<div className='flex flex-col text-xs'>
			<PanelHeader className='gap-3'>
				<TestResultFilterPills
					outcomes={tests.map((test) => test.outcome)}
					filter={filter}
					onChange={setFilter}
					hasSeveralModels={hasSeveralModels && !run.comparison}
				/>
				<RunDescription run={run} mainBranch={mainBranch} />
			</PanelHeader>
			<RunModelsOverview run={run} mainBranch={mainBranch} />
			{hasSeveralModels && !run.comparison ? (
				<TestModelMatrix
					run={run}
					testPaths={visibleTests.map((test) => test.testPath)}
					onOpenTest={openTest}
				/>
			) : (
				<RunTestList run={run} tests={visibleTests} mainBranch={mainBranch} onOpenTest={onOpenTest} />
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
function RunModelsOverview({ run, mainBranch }: { run: TestRunWithResults; mainBranch: string }) {
	if (run.modelSummaries.length === 0) {
		return null;
	}
	if (run.comparison) {
		if (run.models.length > 1) {
			return <ModelChangesChart run={run} mainBranch={mainBranch} />;
		}
		const production = run.modelSummaries.find((summary) => summary.contextVariant === 'production') ?? null;
		const draft = run.modelSummaries.find((summary) => summary.contextVariant === 'draft');
		return draft ? <RunStatStrip summary={draft} baseline={production} baselineLabel={null} /> : null;
	}
	if (run.models.length > 1) {
		return <ModelLeaderboard run={run} />;
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
	mainBranch,
	onOpenTest,
}: {
	run: TestRunWithResults;
	tests: RunTest[];
	mainBranch: string;
	onOpenTest: (explorerPath: string) => void;
}) {
	const isActive = isActiveRun(run);
	const metrics = run.comparison ? null : summarizeTestMetrics(run.results);
	return (
		<ul className='flex flex-col'>
			{tests.length > 0 && (
				<li className='flex justify-end border-b px-3 py-1 text-[11px] text-muted-foreground'>
					{metrics ? (
						<MetricColumns cost='$ / question' toolCalls='Tool calls' duration='Time' />
					) : (
						<ComparisonColumns production={<BranchName name={mainBranch} />} draft='Yours' change={null} />
					)}
				</li>
			)}
			{tests.map((test) => (
				<TestRow
					key={test.testPath}
					icon={<ToneIcon tone={variantTone(run, test.outcome)} isLabelled />}
					name={test.testName}
					path={test.testPath}
					detail={
						test.comparison ? (
							<ComparisonDetail
								comparison={test.comparison}
								mainBranch={mainBranch}
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
			toolCalls={formatCount(testMetrics?.toolCalls)}
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

function RunDescription({ run, mainBranch }: { run: TestRunWithResults; mainBranch: string }) {
	const models = describeTestModels(run.models);
	return (
		<span className='min-w-0 flex-1 truncate text-right'>
			{isActiveRun(run) && `Running ${run.completedAttempts}/${run.totalAttempts} · `}
			{run.comparison &&
				`${mainBranch} ${formatPassRate(run.comparison.production.passedAttempts, run.comparison.production.totalAttempts)} → your changes ${formatPassRate(run.comparison.draft.passedAttempts, run.comparison.draft.totalAttempts)} · `}
			{models}
			{run.attempts > 1 && ` · each test asked ${run.attempts} times`}
			{run.errorMessage && <span className='text-destructive'> · {run.errorMessage}</span>}
		</span>
	);
}

function ComparisonDetail({
	comparison,
	mainBranch,
	attemptsPerVariant,
	isActive,
}: {
	comparison: TestComparisonRow;
	mainBranch: string;
	attemptsPerVariant: number;
	isActive: boolean;
}) {
	return (
		<ComparisonColumns
			production={
				<VariantOutcomeCell
					side={mainBranch}
					outcome={comparison.production}
					attemptsPerVariant={attemptsPerVariant}
				/>
			}
			draft={
				<VariantOutcomeCell side='Yours' outcome={comparison.draft} attemptsPerVariant={attemptsPerVariant} />
			}
			change={
				comparison.change === 'unchanged' ? null : (
					<ComparisonChangeBadge change={comparison.change} isActive={isActive} />
				)
			}
		/>
	);
}

function ComparisonColumns({
	production,
	draft,
	change,
}: {
	production: ReactNode;
	draft: ReactNode;
	change: ReactNode;
}) {
	return (
		<span className='flex shrink-0 items-center'>
			<span className='w-20 truncate text-center'>{production}</span>
			<span className='w-20 truncate text-center'>{draft}</span>
			<span className='flex w-24 justify-end'>{change}</span>
		</span>
	);
}

function AttemptsDetail({
	passedAttempts,
	totalAttempts,
	failure,
}: {
	passedAttempts: number;
	totalAttempts: number;
	failure: string | null;
}) {
	const reason = passedAttempts < totalAttempts ? failure : null;
	return (
		<span className='flex min-w-0 items-center gap-1 text-muted-foreground'>
			{totalAttempts > 1 && (
				<span className='shrink-0'>
					{passedAttempts}/{totalAttempts} passed{reason && ' ·'}
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

/** The tests of a run with their outcome: with the user's changes for a comparison, else over all their attempts. */
function listRunTests(run: TestRunWithResults): RunTest[] {
	const expectedAttempts = run.models.length * run.attempts;
	if (run.comparison) {
		return run.comparison.tests.map((test) => ({
			testPath: test.testPath,
			testName: test.testName,
			outcome: { ...test.draft, expectedAttempts, modelsDisagree: false },
			failure: null,
			comparison: test,
		}));
	}
	const disagreeing = run.models.length > 1 ? listTestsWhereModelsDisagree(run) : new Set<string>();
	return [...groupResultsByTest(run.results)].map(([testPath, results]) => ({
		testPath,
		testName: results[0].testName,
		outcome: {
			passedAttempts: results.filter((result) => result.passed).length,
			totalAttempts: results.length,
			expectedAttempts,
			modelsDisagree: disagreeing.has(testPath),
		},
		failure: findFailureReason(results),
		comparison: null,
	}));
}

function findFailureReason(results: TestResultOutcome[]): string | null {
	const reasons = results.filter((result) => !result.passed).map((result) => result.errorMessage ?? result.message);
	return reasons.find((reason) => reason !== null && reason !== undefined) ?? null;
}

function summarizeTestMetrics(results: TestResultOutcome[]) {
	const metrics = new Map<
		string,
		{ costPerQuestion: number | null; toolCalls: number | null; durationMs: number | null }
	>();
	for (const [testPath, testResults] of groupResultsByTest(results)) {
		metrics.set(testPath, {
			costPerQuestion: average(testResults.map((result) => result.totalCost)),
			toolCalls: average(testResults.map((result) => result.toolCallCount)),
			durationMs: average(testResults.map((result) => result.durationMs)),
		});
	}
	return metrics;
}
