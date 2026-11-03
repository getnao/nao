import { History } from 'lucide-react';
import { useState } from 'react';
import type { LlmSelectedModel } from '@nao/shared/types';

import type { ShownAttempt } from '@/components/settings/test-attempt-details';
import type { RunBranches } from '@/components/settings/test-run-labels';
import type { TestHistoryRun, TestRunResult } from '@/components/settings/test-run-types';
import type { Tone } from '@/components/settings/test-run-verdict';
import { TestAttemptDetails } from '@/components/settings/test-attempt-details';
import { PanelHeader } from '@/components/settings/test-drawer-layout';
import { AttemptDots, ModelName } from '@/components/settings/test-model-results';
import { BranchName, ToneIcon } from '@/components/settings/test-run-labels';
import {
	formatCount,
	formatDuration,
	formatUnitCost,
	isActiveRun,
	isSameTestModel,
	onEnterOrSpace,
	resultModel,
	testModelKey,
} from '@/components/settings/test-run-types';
import { describeRun, variantTone } from '@/components/settings/test-run-verdict';
import { Empty } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

/** The run header sits right above the model table and tabs, so a full border would cut the view in two. */
const LIGHT_HEADER_BORDER_CLASS = 'border-border/50';

type Variant = TestRunResult['contextVariant'];

/** One run of the test: what it found, the model and attempt picked, and what that attempt answered. */
export function RunDetails({
	run,
	isOutdated,
	branches,
}: {
	run: TestHistoryRun;
	/** The run tested an older version of the test shown. */
	isOutdated: boolean;
	branches: RunBranches;
}) {
	const hasSeveralModels = run.models.length > 1;
	const [selectedModel, setSelectedModel] = useState<LlmSelectedModel>(() => pickModelToShow(run));
	const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
	const attempts = listShownAttempts(run, hasSeveralModels ? selectedModel : null);
	const shownAttempt =
		attempts.find((attempt) => attempt.attempt === selectedAttempt) ??
		attempts.find(isFailingAttempt) ??
		attempts.at(0);

	return (
		<div className='flex min-w-0 flex-1 flex-col'>
			<RunHeader run={run} branches={branches} />
			{hasSeveralModels && (
				<TestModelStrip
					run={run}
					branches={branches}
					selectedModel={selectedModel}
					onSelect={(model) => {
						setSelectedModel(model);
						setSelectedAttempt(null);
					}}
				/>
			)}
			{(attempts.length > 1 || isOutdated) && (
				<div className='flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs'>
					{attempts.length > 1 && (
						<AttemptPicker
							run={run}
							attempts={attempts}
							selectedAttempt={shownAttempt?.attempt}
							onSelect={setSelectedAttempt}
						/>
					)}
					{isOutdated && (
						<span className='flex items-center gap-1 text-muted-foreground'>
							<History className='size-3' />
							Ran an older version of this test
						</span>
					)}
				</div>
			)}
			{shownAttempt ? (
				<TestAttemptDetails
					key={`${shownAttempt.attempt}-${testModelKey(selectedModel)}`}
					shownAttempt={shownAttempt}
					branches={branches}
				/>
			) : (
				<Empty className='flex-1'>
					{isActiveRun(run) ? 'Waiting for the first attempt…' : 'No attempt recorded.'}
				</Empty>
			)}
		</div>
	);
}

function RunHeader({ run, branches }: { run: TestHistoryRun; branches: RunBranches }) {
	const verdict = describeRun(run);
	return (
		<PanelHeader className={cn('gap-2 text-xs', LIGHT_HEADER_BORDER_CLASS)}>
			<ToneIcon tone={verdict.tone} />
			<p className='min-w-0 flex-1 truncate' title={verdict.detail ?? undefined}>
				<span className='font-medium text-foreground'>{verdict.title}</span>
				{verdict.detail && <span> — {verdict.detail}</span>}
			</p>
			{run.trigger === 'comparison' && (
				<span className='flex shrink-0 items-center gap-1.5'>
					<VariantPill run={run} variant='production' branch={branches.main} />
					<span className='text-muted-foreground'>→</span>
					<VariantPill run={run} variant='draft' branch={branches.changes} />
				</span>
			)}
		</PanelHeader>
	);
}

/** How one branch of a comparison did, with its count of passed attempts when there are several. */
function VariantPill({ run, variant, branch }: { run: TestHistoryRun; variant: Variant; branch: string }) {
	const outcome = run.comparison?.[variant];
	return (
		<span className='inline-flex items-center gap-1 rounded-full border py-px pr-2 pl-1 text-[11px]'>
			<ToneIcon tone={variantTone(run, outcome)} />
			<BranchName name={branch} />
			{outcome && outcome.total > 1 && (
				<span className='text-muted-foreground tabular-nums'>
					{outcome.passed}/{outcome.total}
				</span>
			)}
		</span>
	);
}

function AttemptPicker({
	run,
	attempts,
	selectedAttempt,
	onSelect,
}: {
	run: TestHistoryRun;
	attempts: ShownAttempt[];
	selectedAttempt: number | undefined;
	onSelect: (attempt: number) => void;
}) {
	return (
		<div role='radiogroup' aria-label='Attempt' className='flex flex-wrap items-center gap-1'>
			{attempts.map((attempt) => (
				<button
					key={attempt.attempt}
					type='button'
					role='radio'
					aria-checked={attempt.attempt === selectedAttempt}
					onClick={() => onSelect(attempt.attempt)}
					className={cn(
						'flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors',
						attempt.attempt === selectedAttempt
							? 'border-primary/40 bg-accent text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					<ToneIcon tone={attemptTone(run, attempt)} />
					Attempt {attempt.attempt}
				</button>
			))}
		</div>
	);
}

/** The models of a run on this test, with their attempts and metrics, to pick the one whose attempts show below. */
function TestModelStrip({
	run,
	branches,
	selectedModel,
	onSelect,
}: {
	run: TestHistoryRun;
	branches: RunBranches;
	selectedModel: LlmSelectedModel;
	onSelect: (model: LlmSelectedModel) => void;
}) {
	const isComparison = run.trigger === 'comparison';
	return (
		<div className='shrink-0 border-b' role='radiogroup' aria-label='Model'>
			<table className='w-full text-xs'>
				<thead>
					<tr className='border-b text-left text-[11px] text-muted-foreground'>
						<th className='px-3 py-1 font-medium'>Model</th>
						{isComparison ? (
							<>
								<th className='px-3 py-1 font-medium'>
									<BranchName name={branches.main} />
								</th>
								<th className='px-3 py-1 font-medium'>
									<BranchName name={branches.changes} />
								</th>
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
						const measuredResults = isComparison
							? modelResults.filter((result) => result.contextVariant === 'draft')
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
								{isComparison ? (
									(['production', 'draft'] as const).map((variant) => (
										<td key={variant} className='px-3 py-1'>
											<AttemptDots
												results={modelResults.filter(
													(result) => result.contextVariant === variant,
												)}
												expected={run.attempts}
											/>
										</td>
									))
								) : (
									<td className='px-3 py-1'>
										<AttemptDots results={modelResults} expected={run.attempts} />
									</td>
								)}
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatUnitCost(averageOf(measuredResults, (result) => result.totalCost))}
								</td>
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatCount(averageOf(measuredResults, (result) => result.toolCallCount))}
								</td>
								<td className='px-3 py-1 text-right tabular-nums'>
									{formatDuration(averageOf(measuredResults, (result) => result.durationMs))}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/** The attempts of the model shown, each paired with the same attempt on the main branch in a comparison. */
function listShownAttempts(run: TestHistoryRun, model: LlmSelectedModel | null): ShownAttempt[] {
	const results = model ? run.results.filter((result) => isSameTestModel(resultModel(result), model)) : run.results;
	if (run.trigger !== 'comparison') {
		return results.map((result) => ({ kind: 'single', attempt: result.attempt, result }));
	}
	const attemptNumbers = [...new Set(results.map((result) => result.attempt))].sort((left, right) => left - right);
	const findResult = (variant: Variant, attempt: number) =>
		results.find((result) => result.contextVariant === variant && result.attempt === attempt) ?? null;
	return attemptNumbers.map((attempt) => ({
		kind: 'comparison',
		attempt,
		production: findResult('production', attempt),
		draft: findResult('draft', attempt),
	}));
}

/** Shows first an attempt that failed, or in a comparison one the changes failed or moved, as that is the one to look into. */
function isFailingAttempt(attempt: ShownAttempt): boolean {
	if (attempt.kind === 'single') {
		return !attempt.result.passed;
	}
	return attempt.draft?.passed === false || attempt.draft?.passed !== attempt.production?.passed;
}

function attemptTone(run: TestHistoryRun, attempt: ShownAttempt): Tone {
	const result = attempt.kind === 'single' ? attempt.result : attempt.draft;
	if (!result) {
		return isActiveRun(run) ? 'pending' : 'neutral';
	}
	return result.passed ? 'pass' : 'fail';
}

/** Shows first a model with a failed attempt, as that is the one to look into. */
function pickModelToShow(run: TestHistoryRun): LlmSelectedModel {
	const failed = run.results.find((result) => !result.passed);
	return failed ? resultModel(failed) : run.models[0];
}

function averageOf(results: TestRunResult[], value: (result: TestRunResult) => number | null): number | null {
	const values = results.map(value).filter((entry): entry is number => typeof entry === 'number');
	return values.length === 0 ? null : values.reduce((sum, entry) => sum + entry, 0) / values.length;
}
