import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleMinus,
	CircleX,
	GitCompareArrows,
	History,
	Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type {
	DraftContext,
	TestFileValidation,
	TestHistoryRun,
	TestRunResult,
} from '@/components/settings/test-run-types';
import { TestAttemptDetails } from '@/components/settings/test-attempt-details';
import { AttemptChatLink } from '@/components/settings/test-run-results';
import { formatCost, getContextChanges, isActiveRun } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const VALIDATION_DEBOUNCE_MS = 500;
const ACTIVE_RUN_REFETCH_MS = 2_000;

type Tone = 'pass' | 'fail' | 'mixed' | 'pending' | 'neutral';
type Variant = TestRunResult['contextVariant'];

interface RunVerdict {
	tone: Tone;
	title: string;
	detail: string | null;
}

const TONE_COLORS: Record<Tone, string> = {
	pass: 'text-green-600 dark:text-green-500',
	fail: 'text-destructive',
	mixed: 'text-amber-600 dark:text-amber-500',
	pending: 'text-muted-foreground',
	neutral: 'text-muted-foreground',
};

const TRIGGER_LABELS: Record<TestHistoryRun['trigger'], string> = {
	comparison: 'Compared with production',
	draft: 'Run on production',
	manual: 'Run of the test suite',
};

interface TestWorkbenchProps {
	testFile: { path: string; content: string };
	draft: DraftContext | null;
	/** Another run of the project is in progress, which blocks starting one. */
	isRunInProgress: boolean;
	onRunStarted: () => void;
}

/** Runs the test open in the editor and shows how its latest runs went, attempt by attempt. */
export function TestWorkbench({ testFile, draft, isRunInProgress, onRunStarted }: TestWorkbenchProps) {
	const queryClient = useQueryClient();
	const debouncedContent = useDebouncedValue(testFile.content, VALIDATION_DEBOUNCE_MS);
	const validation = useMutation(trpc.testRun.validateTestFile.mutationOptions());
	const { mutate: validate } = validation;
	const history = useQuery({
		...trpc.testRun.getTestHistory.queryOptions({ path: testFile.path }),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

	const handleRunStarted = (run: { id: string }) => {
		setSelectedRunId(run.id);
		void queryClient.invalidateQueries({
			queryKey: trpc.testRun.getTestHistory.queryKey({ path: testFile.path }),
		});
		onRunStarted();
	};
	const startRun = useMutation(trpc.testRun.startDraftRun.mutationOptions({ onSuccess: handleRunStarted }));
	const startComparison = useMutation(
		trpc.testRun.startComparisonRun.mutationOptions({ onSuccess: handleRunStarted }),
	);

	useEffect(() => {
		validate({ path: testFile.path, content: debouncedContent });
	}, [validate, testFile.path, debouncedContent]);

	const currentValidation =
		validation.isSuccess && validation.variables.content === testFile.content ? validation.data : undefined;
	const runs = history.data ?? [];
	const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0);
	const contextChangeCount = getContextChanges(draft).length;
	const isStarting = startRun.isPending || startComparison.isPending;
	const disabledReason = !currentValidation?.test
		? 'Fix the test file first.'
		: isRunInProgress || isStarting
			? 'Another test run is in progress.'
			: null;
	const startError = startRun.error?.message ?? startComparison.error?.message;

	const run = () => {
		startComparison.reset();
		startRun.mutate(testFile);
	};
	const compare = () => {
		startRun.reset();
		startComparison.mutate({ testFile });
	};

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs'>
				<div className='min-w-0 flex-1'>
					<ValidationSummary validation={currentValidation} error={validation.error?.message} />
				</div>
				{startError && (
					<span className='max-w-80 truncate text-destructive' title={startError}>
						{startError}
					</span>
				)}
				{contextChangeCount > 0 ? (
					<>
						<StartButton
							variant='ghost'
							icon={<Play className='size-3.5' />}
							label='Run on production'
							tooltip='Runs this test, as it is in the editor, against the production context only.'
							disabledReason={disabledReason}
							isStarting={startRun.isPending}
							onClick={run}
						/>
						<StartButton
							icon={<GitCompareArrows className='size-3.5' />}
							label='Compare with production'
							tooltip={`Runs this test on production and with your ${pluralize(contextChangeCount, 'changed file')}, side by side, to see whether your changes break or fix it.`}
							disabledReason={disabledReason}
							isStarting={startComparison.isPending}
							onClick={compare}
						/>
					</>
				) : (
					<StartButton
						icon={<Play className='size-3.5' />}
						label='Run test'
						tooltip='Runs this test, as it is in the editor, against the production context. Edit other context files to compare your changes with production.'
						disabledReason={disabledReason}
						isStarting={startRun.isPending}
						onClick={run}
					/>
				)}
			</div>

			{history.isLoading ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			) : history.error ? (
				<Empty className='flex-1'>Could not load the runs of this test: {history.error.message}</Empty>
			) : runs.length === 0 || !selectedRun ? (
				<Empty className='flex-1 whitespace-normal'>
					{contextChangeCount > 0
						? 'This test has not run yet. Compare it with production to see how your changes affect it.'
						: 'This test has not run yet. Run it to check that the agent answers like the reference SQL.'}
				</Empty>
			) : (
				<div className='flex min-h-0 flex-1'>
					<RunList
						runs={runs}
						selectedRunId={selectedRun.id}
						currentHash={currentValidation?.test?.hash}
						onSelect={setSelectedRunId}
					/>
					<RunDetails key={selectedRun.id} run={selectedRun} currentHash={currentValidation?.test?.hash} />
				</div>
			)}
		</div>
	);
}

function StartButton({
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

function RunList({
	runs,
	selectedRunId,
	currentHash,
	onSelect,
}: {
	runs: TestHistoryRun[];
	selectedRunId: string;
	currentHash: string | undefined;
	onSelect: (runId: string) => void;
}) {
	return (
		<div className='flex w-56 shrink-0 flex-col overflow-y-auto border-r' role='listbox' aria-label='Runs'>
			{runs.map((run) => {
				const verdict = describeRun(run);
				const isOutdated = isRunOfAnotherVersion(run, currentHash);
				return (
					<button
						key={run.id}
						type='button'
						role='option'
						aria-selected={run.id === selectedRunId}
						onClick={() => onSelect(run.id)}
						className={cn(
							'flex cursor-pointer items-start gap-2 border-b px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50',
							run.id === selectedRunId && 'bg-accent',
						)}
					>
						<ToneIcon tone={verdict.tone} className='mt-px' />
						<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
							<span className='truncate font-medium text-foreground'>{verdict.title}</span>
							<span className='flex items-center gap-1 truncate text-muted-foreground'>
								{TRIGGER_LABELS[run.trigger]} ·{' '}
								{getTimeAgo(new Date(run.createdAt).getTime()).humanReadable}
								{isOutdated && <History className='size-3 shrink-0' aria-label='Older version' />}
							</span>
						</span>
					</button>
				);
			})}
		</div>
	);
}

function RunDetails({ run, currentHash }: { run: TestHistoryRun; currentHash: string | undefined }) {
	const verdict = describeRun(run);
	const isComparison = run.trigger === 'comparison';
	const [variant, setVariant] = useState<Variant>(isComparison ? 'draft' : 'production');
	const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
	const variantResults = run.results.filter((result) => !isComparison || result.contextVariant === variant);
	const result =
		variantResults.find((candidate) => candidate.id === selectedResultId) ??
		variantResults.find((candidate) => !candidate.passed) ??
		variantResults.at(0);

	return (
		<div className='flex min-w-0 flex-1 flex-col'>
			<div className='flex shrink-0 flex-col gap-2 border-b px-3 py-2 text-xs'>
				<div className='flex items-start gap-2'>
					<ToneIcon tone={verdict.tone} className='mt-px' />
					<p className='min-w-0 flex-1'>
						<span className='font-medium text-foreground'>{verdict.title}</span>
						{verdict.detail && <span className='text-muted-foreground'> — {verdict.detail}</span>}
					</p>
					<Link
						to='/settings/tests'
						search={{ run: run.id }}
						className='shrink-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
					>
						Open in Tests
					</Link>
				</div>
				{(isComparison || variantResults.length > 1 || isRunOfAnotherVersion(run, currentHash)) && (
					<div className='flex flex-wrap items-center gap-2'>
						{isComparison && (
							<VariantToggle
								run={run}
								variant={variant}
								onChange={(next) => {
									setVariant(next);
									setSelectedResultId(null);
								}}
							/>
						)}
						{variantResults.length > 1 && (
							<AttemptPicker
								results={variantResults}
								selectedResultId={result?.id}
								onSelect={setSelectedResultId}
							/>
						)}
						{isRunOfAnotherVersion(run, currentHash) && (
							<span className='flex items-center gap-1 text-muted-foreground'>
								<History className='size-3' />
								Ran an older version of this test
							</span>
						)}
					</div>
				)}
			</div>
			{result ? (
				<TestAttemptDetails
					result={result}
					actions={
						<span className='flex items-center gap-2 text-xs text-muted-foreground'>
							<span>
								{result.llmModelId}
								{result.durationMs ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : ''}
								{result.totalCost !== null ? ` · ${formatCost(result.totalCost)}` : ''}
							</span>
							<AttemptChatLink result={result} />
						</span>
					}
				/>
			) : (
				<Empty className='flex-1'>
					{isActiveRun(run) ? 'Waiting for the first attempt…' : 'No attempt recorded.'}
				</Empty>
			)}
		</div>
	);
}

function VariantToggle({
	run,
	variant,
	onChange,
}: {
	run: TestHistoryRun;
	variant: Variant;
	onChange: (variant: Variant) => void;
}) {
	const options: { id: Variant; label: string }[] = [
		{ id: 'production', label: 'Production' },
		{ id: 'draft', label: 'Your changes' },
	];
	return (
		<div role='radiogroup' aria-label='Context' className='flex rounded-md border p-0.5'>
			{options.map((option) => {
				const outcome = run.comparison?.[option.id];
				return (
					<button
						key={option.id}
						type='button'
						role='radio'
						aria-checked={variant === option.id}
						onClick={() => onChange(option.id)}
						className={cn(
							'flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors',
							variant === option.id
								? 'bg-accent text-foreground'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						<ToneIcon tone={outcome ? outcomeTone(outcome.passed, outcome.total) : 'pending'} />
						{option.label}
						{outcome && outcome.total > 1 && (
							<span className='text-muted-foreground'>
								{outcome.passed}/{outcome.total}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

function AttemptPicker({
	results,
	selectedResultId,
	onSelect,
}: {
	results: TestRunResult[];
	selectedResultId: string | undefined;
	onSelect: (resultId: string) => void;
}) {
	const hasSeveralModels = new Set(results.map((result) => result.llmModelId)).size > 1;
	return (
		<div role='radiogroup' aria-label='Attempt' className='flex flex-wrap items-center gap-1'>
			{results.map((result) => (
				<button
					key={result.id}
					type='button'
					role='radio'
					aria-checked={result.id === selectedResultId}
					onClick={() => onSelect(result.id)}
					className={cn(
						'flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors',
						result.id === selectedResultId
							? 'border-primary/40 bg-accent text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					<ToneIcon tone={result.passed ? 'pass' : 'fail'} />
					{hasSeveralModels ? `${result.llmModelId} #${result.attempt}` : `Attempt ${result.attempt}`}
				</button>
			))}
		</div>
	);
}

function ValidationSummary({ validation, error }: { validation: TestFileValidation | undefined; error?: string }) {
	if (error) {
		return <span className='block truncate text-destructive'>Could not check the test: {error}</span>;
	}
	if (!validation) {
		return <span className='text-muted-foreground'>Checking the test…</span>;
	}
	if (validation.error !== null || !validation.test) {
		return (
			<SimpleTooltip content={<pre className='font-mono whitespace-pre-wrap'>{validation.error}</pre>}>
				<span className='flex min-w-0 items-center gap-1 text-destructive'>
					<CircleAlert className='size-3.5 shrink-0' />
					<span className='truncate'>Invalid test: {validation.error}</span>
				</span>
			</SimpleTooltip>
		);
	}
	const { test } = validation;
	return (
		<span className='block truncate text-muted-foreground' title={test.prompt}>
			<span className='font-medium text-foreground'>{test.name}</span>
			{test.tags.length > 0 && <> · {test.tags.join(', ')}</>}
			{!test.sql && <> · no reference SQL</>}
			{test.assertions.length > 0 && <> · {pluralize(test.assertions.length, 'assertion')}</>}
		</span>
	);
}

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
	if (tone === 'pending') {
		return <Spinner className={cn('size-3.5 shrink-0', className)} />;
	}
	const Icon = { pass: CircleCheck, fail: CircleX, mixed: CircleDashed, neutral: CircleMinus }[tone];
	return <Icon className={cn('size-3.5 shrink-0', TONE_COLORS[tone], className)} />;
}

/** What a run says about the test, in words, from the attempts recorded so far. */
function describeRun(run: TestHistoryRun): RunVerdict {
	const expectedAttempts = run.attemptsPerVariant * (run.trigger === 'comparison' ? 2 : 1);
	if (isActiveRun(run)) {
		return { tone: 'pending', title: `Running ${run.results.length}/${expectedAttempts}`, detail: null };
	}
	if (run.status !== 'completed') {
		return { tone: 'neutral', title: `Run ${run.status}`, detail: run.errorMessage };
	}
	if (run.comparison) {
		return describeComparison(run.comparison);
	}
	const passed = run.results.filter((result) => result.passed).length;
	const total = run.results.length;
	if (total === 0) {
		return { tone: 'neutral', title: 'No result', detail: 'The run recorded no attempt for this test.' };
	}
	if (passed === total) {
		return {
			tone: 'pass',
			title: 'Passed',
			detail:
				total === 1
					? 'the agent answers like the reference.'
					: `all ${total} attempts answer like the reference.`,
		};
	}
	if (passed === 0) {
		const failure = run.results.find((result) => !result.passed);
		return { tone: 'fail', title: 'Failed', detail: failure?.errorMessage ?? failure?.message ?? null };
	}
	return { tone: 'mixed', title: 'Flaky', detail: `${passed} of ${total} attempts pass.` };
}

function describeComparison(comparison: NonNullable<TestHistoryRun['comparison']>): RunVerdict {
	const { production, draft } = comparison;
	switch (comparison.change) {
		case 'regressed':
			return {
				tone: 'fail',
				title: 'Broken by your changes',
				detail: 'it passes on production and fails with your changes.',
			};
		case 'worsened':
			return {
				tone: 'fail',
				title: 'Less reliable with your changes',
				detail: `${production.passed}/${production.total} attempts pass on production, ${draft.passed}/${draft.total} with your changes.`,
			};
		case 'fixed':
			return {
				tone: 'pass',
				title: 'Fixed by your changes',
				detail: 'it fails on production and passes with your changes.',
			};
		case 'improved':
			return {
				tone: 'pass',
				title: 'More reliable with your changes',
				detail: `${production.passed}/${production.total} attempts pass on production, ${draft.passed}/${draft.total} with your changes.`,
			};
		case 'unchanged': {
			const tone = outcomeTone(draft.passed, draft.total);
			const title =
				tone === 'pass' ? 'Passes on both' : tone === 'fail' ? 'Fails on both' : 'Same results on both';
			const detail =
				tone === 'pass'
					? 'your changes keep this test passing.'
					: tone === 'fail'
						? 'your changes do not fix this test.'
						: `${draft.passed}/${draft.total} attempts pass on production and with your changes.`;
			return { tone, title, detail };
		}
		case 'pending':
			return { tone: 'neutral', title: 'Incomplete', detail: 'some attempts did not finish.' };
	}
}

function outcomeTone(passed: number, total: number): Tone {
	if (total === 0) {
		return 'pending';
	}
	return passed === total ? 'pass' : passed === 0 ? 'fail' : 'mixed';
}

function isRunOfAnotherVersion(run: TestHistoryRun, currentHash: string | undefined): boolean {
	const ranHash = run.results.at(0)?.testHash;
	return !!currentHash && !!ranHash && ranHash !== currentHash;
}

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
