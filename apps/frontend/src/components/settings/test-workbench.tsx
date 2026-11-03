import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX, History } from 'lucide-react';
import { useState } from 'react';
import type { LlmSelectedModel } from '@nao/shared/types';

import type { DraftContext, TestHistoryRun, TestRunResult } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import { AttemptChatLink, TestAttemptDetails } from '@/components/settings/test-attempt-details';
import { AttemptDots, ModelName } from '@/components/settings/test-model-results';
import {
	formatCost,
	formatCount,
	formatDuration,
	formatUnitCost,
	getContextChanges,
	isActiveRun,
	isSameTestModel,
	onEnterOrSpace,
	resultModel,
	testModelKey,
} from '@/components/settings/test-run-types';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

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
	/** The check of the test as it is in the editor. */
	validation: TestFileValidationState;
	draft: DraftContext | null;
	/** The run shown, or `null` for the latest one. */
	selectedRunId: string | null;
	onSelectRun: (runId: string) => void;
}

/** Shows how the latest runs of the test open in the editor went, attempt by attempt. */
export function TestWorkbench({ testFile, validation, draft, selectedRunId, onSelectRun }: TestWorkbenchProps) {
	const history = useQuery({
		...trpc.testRun.getTestHistory.queryOptions({ path: testFile.path }),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const currentHash = validation.validation?.test?.hash;
	const runs = history.data ?? [];
	const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0);
	const contextChangeCount = getContextChanges(draft).length;

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<ValidationNotice validation={validation} />

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
						currentHash={currentHash}
						onSelect={onSelectRun}
					/>
					<RunDetails key={selectedRun.id} run={selectedRun} currentHash={currentHash} />
				</div>
			)}
		</div>
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
	const hasSeveralModels = run.models.length > 1;
	const [selectedModel, setSelectedModel] = useState<LlmSelectedModel>(() => pickModelToShow(run));
	const variantResults = run.results.filter(
		(result) =>
			(!isComparison || result.contextVariant === variant) &&
			(!hasSeveralModels || isSameTestModel(resultModel(result), selectedModel)),
	);
	const result =
		variantResults.find((candidate) => candidate.id === selectedResultId) ??
		variantResults.find((candidate) => !candidate.passed) ??
		variantResults.at(0);

	return (
		<div className='flex min-w-0 flex-1 flex-col'>
			<div className='flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs'>
				<ToneIcon tone={verdict.tone} className='mt-px' />
				<p className='min-w-0 flex-1'>
					<span className='font-medium text-foreground'>{verdict.title}</span>
					{verdict.detail && <span className='text-muted-foreground'> — {verdict.detail}</span>}
				</p>
			</div>
			{hasSeveralModels && (
				<TestModelStrip
					run={run}
					variant={isComparison ? variant : null}
					selectedModel={selectedModel}
					onSelect={(model) => {
						setSelectedModel(model);
						setSelectedResultId(null);
					}}
				/>
			)}
			{(isComparison || variantResults.length > 1 || isRunOfAnotherVersion(run, currentHash)) && (
				<div className='flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs'>
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
			{result ? (
				<TestAttemptDetails
					result={result}
					actions={
						<span className='flex items-center gap-2 text-xs text-muted-foreground'>
							<span className='tabular-nums'>{describeAttemptMetrics(result)}</span>
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
						<ToneIcon tone={variantTone(run, outcome)} />
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
					Attempt {result.attempt}
				</button>
			))}
		</div>
	);
}

/** Says why the test cannot run, and nothing while it is valid, as the tab already names it. */
function ValidationNotice({ validation }: { validation: TestFileValidationState }) {
	const message = validation.error
		? `Could not check the test: ${validation.error}`
		: validation.validation && (validation.validation.error !== null || !validation.validation.test)
			? `Invalid test: ${validation.validation.error}`
			: null;
	if (!message) {
		return null;
	}
	return (
		<div className='flex shrink-0 items-start gap-1.5 border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive'>
			<CircleAlert className='mt-px size-3.5 shrink-0' />
			<pre className='min-w-0 font-sans whitespace-pre-wrap'>{message}</pre>
		</div>
	);
}

/** The models of a run on this test, with their attempts and metrics, to pick the one whose attempts show below. */
function TestModelStrip({
	run,
	variant,
	selectedModel,
	onSelect,
}: {
	run: TestHistoryRun;
	/** The context variant shown, or null when the run did not compare variants. */
	variant: Variant | null;
	selectedModel: LlmSelectedModel;
	onSelect: (model: LlmSelectedModel) => void;
}) {
	return (
		<div className='shrink-0 border-b' role='radiogroup' aria-label='Model'>
			<table className='w-full text-xs'>
				<thead>
					<tr className='border-b text-left text-[11px] text-muted-foreground'>
						<th className='px-3 py-1 font-medium'>Model</th>
						{variant ? (
							<>
								<th className='px-3 py-1 font-medium'>Production</th>
								<th className='px-3 py-1 font-medium'>Your changes</th>
							</>
						) : (
							<th className='px-3 py-1 font-medium'>Attempts</th>
						)}
						<th className='px-3 py-1 text-right font-medium'>$ / question</th>
						<th className='px-3 py-1 text-right font-medium'>Tool calls</th>
						<th className='px-3 py-1 text-right font-medium'>Time</th>
					</tr>
				</thead>
				<tbody>
					{run.models.map((model) => {
						const modelResults = run.results.filter((result) =>
							isSameTestModel(resultModel(result), model),
						);
						const shownResults = variant
							? modelResults.filter((result) => result.contextVariant === variant)
							: modelResults;
						const isSelected = isSameTestModel(model, selectedModel);
						return (
							<tr
								key={testModelKey(model)}
								role='radio'
								aria-checked={isSelected}
								tabIndex={0}
								onClick={() => onSelect(model)}
								onKeyDown={onEnterOrSpace(() => onSelect(model))}
								className={cn(
									'cursor-pointer border-b transition-colors last:border-b-0 hover:bg-accent/50',
									isSelected && 'bg-accent',
								)}
							>
								<td className='px-3 py-1'>
									<ModelName models={run.models} model={model} isBold={isSelected} />
								</td>
								{variant ? (
									<>
										<td className='px-3 py-1'>
											<AttemptDots
												results={modelResults.filter(
													(result) => result.contextVariant === 'production',
												)}
												expected={run.attempts}
											/>
										</td>
										<td className='px-3 py-1'>
											<AttemptDots
												results={modelResults.filter(
													(result) => result.contextVariant === 'draft',
												)}
												expected={run.attempts}
											/>
										</td>
									</>
								) : (
									<td className='px-3 py-1'>
										<AttemptDots results={modelResults} expected={run.attempts} />
									</td>
								)}
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatUnitCost(averageOf(shownResults, (result) => result.totalCost))}
								</td>
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatCount(averageOf(shownResults, (result) => result.toolCallCount))}
								</td>
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatDuration(averageOf(shownResults, (result) => result.durationMs))}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/** Shows first a model with a failed attempt, as that is the one to look into. */
function pickModelToShow(run: TestHistoryRun): LlmSelectedModel {
	const failed = run.results.find((result) => !result.passed);
	return failed ? resultModel(failed) : run.models[0];
}

function describeAttemptMetrics(result: TestRunResult): string {
	return [
		result.llmModelId,
		result.durationMs ? formatDuration(result.durationMs) : null,
		result.toolCallCount !== null ? pluralize(result.toolCallCount, 'tool call') : null,
		result.totalTokens !== null ? `${formatCount(result.totalTokens)} tokens` : null,
		result.totalCost !== null ? formatCost(result.totalCost) : null,
	]
		.filter((part) => part !== null)
		.join(' · ');
}

function averageOf(results: TestRunResult[], value: (result: TestRunResult) => number | null): number | null {
	const values = results.map(value).filter((entry): entry is number => typeof entry === 'number');
	return values.length === 0 ? null : values.reduce((sum, entry) => sum + entry, 0) / values.length;
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
	if (run.models.length > 1) {
		return describeModels(run);
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

/** What a run of several models says about the test: on which models every attempt passed. */
function describeModels(run: TestHistoryRun): RunVerdict {
	const outcomes = run.models.map((model) => {
		const results = run.results.filter((result) => isSameTestModel(resultModel(result), model));
		return { model, passed: results.filter((result) => result.passed).length, total: results.length };
	});
	const passingCount = outcomes.filter((outcome) => outcome.total > 0 && outcome.passed === outcome.total).length;
	const failing = outcomes
		.filter((outcome) => outcome.passed < outcome.total)
		.map((outcome) => outcome.model.modelId);
	if (passingCount === outcomes.length) {
		return { tone: 'pass', title: `Passes on all ${outcomes.length} models`, detail: null };
	}
	if (passingCount === 0 && outcomes.every((outcome) => outcome.passed === 0)) {
		return { tone: 'fail', title: `Fails on all ${outcomes.length} models`, detail: null };
	}
	return {
		tone: 'mixed',
		title: `Passes on ${passingCount} of ${outcomes.length} models`,
		detail: `${failing.join(', ')} ${failing.length === 1 ? 'misses' : 'miss'} some attempts.`,
	};
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

/** A variant without a recorded attempt is still pending while the run is active, and left unfinished once it stopped. */
function variantTone(run: TestHistoryRun, outcome: { passed: number; total: number } | undefined): Tone {
	if (!outcome || outcome.total === 0) {
		return isActiveRun(run) ? 'pending' : 'neutral';
	}
	return outcomeTone(outcome.passed, outcome.total);
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
