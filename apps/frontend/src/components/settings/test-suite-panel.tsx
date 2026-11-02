import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleMinus,
	CircleX,
	FlaskConical,
	GitCompareArrows,
	History,
	Play,
	X,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type {
	DraftContext,
	TestRunSummary,
	TestRunWithResults,
	TestSuiteListing,
} from '@/components/settings/test-run-types';
import { DraftContextWarnings } from '@/components/settings/draft-comparison-card';
import {
	ComparisonChangeBadge,
	ContextChangeItem,
	VariantOutcomeCell,
} from '@/components/settings/test-comparison-results';
import {
	formatPassRate,
	getContextChanges,
	isActiveRun,
	toExplorerTestPath,
} from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const ACTIVE_RUN_REFETCH_MS = 2_000;
const MAX_LISTED_RUNS = 10;
const MAX_LISTED_CHANGES = 4;
const SUITE_VIEW = 'suite';

interface TestSuitePanelProps {
	draft: DraftContext | null;
	runs: TestRunSummary[] | undefined;
	activeRun: TestRunSummary | undefined;
	onRunsChanged: () => void;
	onOpenTest: (explorerPath: string) => void;
}

/** Runs the whole test suite, on production or side by side with the user's changes, and lists the latest runs. */
export function TestSuitePanel({ draft, runs, activeRun, onRunsChanged, onOpenTest }: TestSuitePanelProps) {
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const [view, setView] = useState<string>(SUITE_VIEW);
	const selectedRunId = view === SUITE_VIEW ? null : view;
	const openedRun = useQuery({
		...trpc.testRun.getRun.queryOptions({ runId: selectedRunId ?? '' }),
		enabled: selectedRunId !== null,
		refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? ACTIVE_RUN_REFETCH_MS : false),
	});

	const handleRunStarted = (run: { id: string }) => {
		setView(run.id);
		onRunsChanged();
	};
	const startRun = useMutation(trpc.testRun.startRun.mutationOptions({ onSuccess: handleRunStarted }));
	const startComparison = useMutation(
		trpc.testRun.startComparisonRun.mutationOptions({ onSuccess: handleRunStarted }),
	);
	const cancelRun = useMutation(trpc.testRun.cancelRun.mutationOptions({ onSuccess: onRunsChanged }));

	const contextChanges = getContextChanges(draft);
	const testCount = suite.data?.tests.length ?? 0;
	const isStarting = startRun.isPending || startComparison.isPending;
	const disabledReason =
		testCount === 0
			? 'Add a test to the tests/ folder first.'
			: activeRun || isStarting
				? 'Another test run is in progress.'
				: null;
	const startError = startRun.error?.message ?? startComparison.error?.message;

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 flex-col gap-1.5 border-b px-3 py-1.5 text-xs'>
				<div className='flex items-center gap-3'>
					<div className='min-w-0 flex-1 text-muted-foreground'>
						{contextChanges.length > 0 ? (
							<span className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5'>
								<span>
									You changed {pluralize(contextChanges.length, 'context file')}
									{draft?.branch && (
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
						) : (
							<span>
								{pluralize(testCount, 'test')} in <span className='font-mono'>tests/</span>, run against
								the production context. Edit context files to compare your changes with production.
							</span>
						)}
					</div>
					{startError && (
						<span className='max-w-80 truncate text-destructive' title={startError}>
							{startError}
						</span>
					)}
					{activeRun ? (
						<Button
							type='button'
							size='sm'
							variant='ghost'
							className='h-7 gap-1.5 text-xs'
							disabled={cancelRun.isPending}
							onClick={() => cancelRun.mutate({ runId: activeRun.id })}
						>
							{cancelRun.isPending ? <Spinner className='size-3.5' /> : <X className='size-3.5' />}
							Cancel run
						</Button>
					) : contextChanges.length > 0 ? (
						<>
							<SuiteStartButton
								variant='ghost'
								icon={<Play className='size-3.5' />}
								label='Run on production'
								tooltip='Runs every test against the production context only.'
								disabledReason={disabledReason}
								isStarting={startRun.isPending}
								onClick={() => startRun.mutate({})}
							/>
							<SuiteStartButton
								icon={<GitCompareArrows className='size-3.5' />}
								label='Compare all tests with production'
								tooltip='Runs every test on production and with your changes, side by side, to see which ones your changes break or fix.'
								disabledReason={disabledReason}
								isStarting={startComparison.isPending}
								onClick={() => startComparison.mutate({})}
							/>
						</>
					) : (
						<SuiteStartButton
							icon={<Play className='size-3.5' />}
							label={`Run ${pluralize(testCount, 'test')}`}
							tooltip='Runs every test against the production context.'
							disabledReason={disabledReason}
							isStarting={startRun.isPending}
							onClick={() => startRun.mutate({})}
						/>
					)}
				</div>
				{draft && contextChanges.length > 0 && <DraftContextWarnings draft={draft} />}
			</div>

			<div className='flex min-h-0 flex-1'>
				<nav className='flex w-56 shrink-0 flex-col overflow-y-auto border-r text-xs' aria-label='Test runs'>
					<NavItem isSelected={view === SUITE_VIEW} onClick={() => setView(SUITE_VIEW)}>
						<FlaskConical className='size-3.5 shrink-0 text-muted-foreground' />
						<span className='flex-1 truncate font-medium text-foreground'>Tests</span>
						<span className='text-muted-foreground'>{testCount}</span>
					</NavItem>
					<span className='px-3 pt-3 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase'>
						Recent runs
					</span>
					{runs?.length === 0 && <span className='px-3 py-1 text-muted-foreground'>No run yet.</span>}
					{runs?.slice(0, MAX_LISTED_RUNS).map((run) => (
						<NavItem key={run.id} isSelected={view === run.id} onClick={() => setView(run.id)}>
							<RunStatusIcon run={run} className='mt-px self-start' />
							<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
								<span className='truncate font-medium text-foreground'>{summarizeRun(run)}</span>
								<span className='truncate text-muted-foreground'>
									{describeRunScope(run)} ·{' '}
									{getTimeAgo(new Date(run.createdAt).getTime()).humanReadable}
								</span>
							</span>
						</NavItem>
					))}
				</nav>

				<div className='min-w-0 flex-1 overflow-y-auto'>
					{view === SUITE_VIEW ? (
						<SuiteTests suite={suite.data} isLoading={suite.isLoading} onOpenTest={onOpenTest} />
					) : openedRun.isLoading ? (
						<div className='flex h-full items-center justify-center'>
							<Spinner />
						</div>
					) : openedRun.data ? (
						<RunTests run={openedRun.data} onOpenTest={onOpenTest} />
					) : (
						<Empty className='h-full'>Could not open this run: {openedRun.error?.message}</Empty>
					)}
				</div>
			</div>
		</div>
	);
}

function SuiteStartButton({
	icon,
	label,
	tooltip,
	disabledReason,
	isStarting,
	onClick,
	variant = 'default',
}: {
	icon: ReactNode;
	label: string;
	tooltip: string;
	disabledReason: string | null;
	isStarting: boolean;
	onClick: () => void;
	variant?: 'default' | 'ghost';
}) {
	return (
		<SimpleTooltip content={disabledReason ?? tooltip} side='top'>
			<span className='shrink-0'>
				<Button
					type='button'
					size='sm'
					variant={variant}
					className='h-7 gap-1.5 text-xs'
					disabled={disabledReason !== null}
					onClick={onClick}
				>
					{isStarting ? <Spinner className='size-3.5' /> : icon}
					{label}
				</Button>
			</span>
		</SimpleTooltip>
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
	onOpenTest,
}: {
	suite: TestSuiteListing | undefined;
	isLoading: boolean;
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
	return (
		<ul className='flex flex-col text-xs'>
			{suite.settings.errors.map((error) => (
				<li key={error} className='flex items-start gap-2 border-b px-3 py-2 text-destructive'>
					<CircleAlert className='mt-px size-3.5 shrink-0' />
					<span className='font-mono whitespace-pre-wrap'>nao_config.yaml: {error}</span>
				</li>
			))}
			{suite.invalidFiles.map((file) => (
				<TestRow
					key={file.path}
					name={file.path}
					path={file.path}
					status={
						<span className='flex min-w-0 items-center gap-1 text-destructive' title={file.error}>
							<CircleAlert className='size-3.5 shrink-0' />
							<span className='truncate'>Invalid: {file.error}</span>
						</span>
					}
					onOpen={onOpenTest}
				/>
			))}
			{suite.tests.map((test) => {
				const outcome = suite.latestOutcomes[test.path];
				return (
					<TestRow
						key={test.path}
						name={test.name}
						path={test.path}
						status={
							outcome && outcome.totalAttempts > 0 ? (
								<AttemptsOutcome
									passed={outcome.passedAttempts}
									total={outcome.totalAttempts}
									isOutdated={outcome.isOutdated}
								/>
							) : (
								<span className='flex items-center gap-1 text-muted-foreground'>
									<CircleDashed className='size-3.5' />
									Never run
								</span>
							)
						}
						onOpen={onOpenTest}
					/>
				);
			})}
		</ul>
	);
}

function RunTests({ run, onOpenTest }: { run: TestRunWithResults; onOpenTest: (explorerPath: string) => void }) {
	const isActive = isActiveRun(run);
	const attemptsPerVariant = run.models.length * run.attempts;
	return (
		<div className='flex flex-col text-xs'>
			<div className='flex items-center gap-3 border-b px-3 py-2 text-muted-foreground'>
				<span className='min-w-0 flex-1 truncate'>
					{run.comparison ? (
						<>
							Production{' '}
							{formatPassRate(run.comparison.production.passed, run.comparison.production.total)} → your
							changes {formatPassRate(run.comparison.draft.passed, run.comparison.draft.total)} ·{' '}
						</>
					) : (
						<>{formatPassRate(run.passedAttempts, run.completedAttempts)} passed · </>
					)}
					{run.completedAttempts}/{run.totalAttempts} attempts ·{' '}
					{run.models.map((model) => model.modelId).join(', ')}
					{run.errorMessage && <span className='text-destructive'> · {run.errorMessage}</span>}
				</span>
				<Link
					to='/settings/tests'
					search={{ run: run.id }}
					className='shrink-0 underline-offset-4 hover:text-foreground hover:underline'
				>
					Open in Tests
				</Link>
			</div>
			{run.comparison ? (
				<ul className='flex flex-col'>
					{run.comparison.tests.map((test) => (
						<TestRow
							key={test.testPath}
							name={test.testName}
							path={test.testPath}
							status={
								<span className='flex items-center gap-3'>
									<span className='flex items-center gap-1.5'>
										<span className='text-muted-foreground'>Production</span>
										<VariantOutcomeCell
											outcome={test.production}
											attemptsPerVariant={attemptsPerVariant}
										/>
									</span>
									<span className='flex items-center gap-1.5'>
										<span className='text-muted-foreground'>Yours</span>
										<VariantOutcomeCell
											outcome={test.draft}
											attemptsPerVariant={attemptsPerVariant}
										/>
									</span>
									<ComparisonChangeBadge change={test.change} isActive={isActive} />
								</span>
							}
							onOpen={onOpenTest}
						/>
					))}
				</ul>
			) : (
				<ul className='flex flex-col'>
					{groupResultsByTest(run.results).map((test) => (
						<TestRow
							key={test.testPath}
							name={test.testName}
							path={test.testPath}
							status={<AttemptsOutcome passed={test.passed} total={test.total} failure={test.failure} />}
							onOpen={onOpenTest}
						/>
					))}
				</ul>
			)}
			{run.results.length === 0 && (
				<Empty className='py-6'>{isActive ? 'Waiting for the first results…' : 'No results recorded.'}</Empty>
			)}
		</div>
	);
}

function TestRow({
	name,
	path,
	status,
	onOpen,
}: {
	name: string;
	path: string;
	status: ReactNode;
	onOpen: (explorerPath: string) => void;
}) {
	return (
		<li className='border-b'>
			<button
				type='button'
				onClick={() => onOpen(toExplorerTestPath(path))}
				className='flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-accent/50'
				title='Open this test'
			>
				<span className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate font-medium text-foreground'>{name}</span>
					<span className='truncate font-mono text-[11px] text-muted-foreground'>tests/{path}</span>
				</span>
				<span className='flex min-w-0 shrink-0 items-center'>{status}</span>
			</button>
		</li>
	);
}

function AttemptsOutcome({
	passed,
	total,
	isOutdated = false,
	failure,
}: {
	passed: number;
	total: number;
	isOutdated?: boolean;
	failure?: string | null;
}) {
	const allPassed = passed === total;
	const Icon = allPassed ? CircleCheck : passed === 0 ? CircleX : CircleDashed;
	return (
		<span
			className={cn(
				'flex min-w-0 items-center gap-1',
				allPassed
					? 'text-green-600 dark:text-green-500'
					: passed === 0
						? 'text-destructive'
						: 'text-amber-600 dark:text-amber-500',
				isOutdated && 'opacity-60',
			)}
			title={isOutdated ? 'The test changed after this run' : undefined}
		>
			<Icon className='size-3.5 shrink-0' />
			<span className='max-w-64 truncate'>
				{total > 1 ? `${passed}/${total} passed` : allPassed ? 'Passed' : 'Failed'}
				{!allPassed && failure ? ` · ${failure}` : ''}
			</span>
			{isOutdated && <History className='size-3 shrink-0' />}
		</span>
	);
}

function RunStatusIcon({ run, className }: { run: TestRunSummary; className?: string }) {
	if (isActiveRun(run)) {
		return <Spinner className={cn('size-3.5 shrink-0', className)} />;
	}
	if (run.status !== 'completed') {
		return <CircleMinus className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />;
	}
	const passed = run.variantTotals?.draft.passed ?? run.passedAttempts;
	const total = run.variantTotals?.draft.total ?? run.totalAttempts;
	const Icon = passed === total ? CircleCheck : passed === 0 ? CircleX : CircleDashed;
	return (
		<Icon
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
	return `${formatPassRate(run.passedAttempts, run.totalAttempts)} passed`;
}

function describeRunScope(run: TestRunSummary): string {
	const testCount = run.selection?.length ?? 0;
	const scope = testCount === 1 ? (run.selection?.[0] ?? '') : pluralize(testCount, 'test');
	return run.trigger === 'comparison' ? `Compared ${scope}` : scope;
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

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
