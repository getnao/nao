import { GitBranch, History } from 'lucide-react';

import type { TestRunSummary } from '@/components/settings/test-run-types';
import type { Tone } from '@/components/settings/test-run-verdict';
import { CHANGES_FALLBACK, TONE_LABELS, ToneIcon } from '@/components/settings/test-run-labels';
import { getSingleRunVariant, isActiveRun } from '@/components/settings/test-run-types';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

/** A run of the suite, or of one test in its history, which then counts only that test. */
export type RunListSource = Pick<
	TestRunSummary,
	| 'status'
	| 'trigger'
	| 'selection'
	| 'models'
	| 'attempts'
	| 'completedAttempts'
	| 'totalAttempts'
	| 'contextRef'
	| 'errorMessage'
	| 'triggeredByName'
	| 'createdAt'
	| 'testTotals'
>;

type VariantTotals = TestRunSummary['testTotals'][number];
type TestTotals = Omit<VariantTotals, 'contextVariant' | 'models'>;

export type RunListState = 'running' | 'passed' | 'failed' | 'flaky' | 'cancelled' | 'error' | 'empty';

interface RunListChip {
	label: string;
	isBranch: boolean;
	/** Set on the branch a comparison ran against, read "vs main". */
	isComparedBranch?: boolean;
}

interface RunListItemView {
	state: RunListState;
	scope: string;
	result: { label: string; tooltip: string } | null;
	/** Share of the run done, while it runs. */
	progress: number | null;
	chips: RunListChip[];
	statusTooltip: { status: string; startedBy: string };
}

export interface RunListContext {
	/** The branch production comes from, `main` when the context has no git repository. */
	mainBranch: string;
	/** The tests of the suite, to tell a run of all of them apart from a partial one. */
	suiteTestPaths?: string[];
	/** Names every run after this test, in the history of one test where each run counts only that test. */
	testPath?: string;
}

const TEST_FILE_EXTENSION = /\.ya?ml$/;

const STATE_TONES: Record<RunListState, Tone> = {
	running: 'pending',
	passed: 'pass',
	failed: 'fail',
	flaky: 'mixed',
	cancelled: 'cancelled',
	error: 'error',
	empty: 'neutral',
};

/** A run of the Recent runs list: its state, what it ran, its result and chips for what was special about it. */
export function RunListItem({
	view,
	isSelected,
	isOutdated = false,
	isOption = false,
	onSelect,
}: {
	view: RunListItemView;
	isSelected: boolean;
	/** The run tested an older version of the test shown. */
	isOutdated?: boolean;
	/** Rendered as an option of a listbox rather than as a link-like button. */
	isOption?: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type='button'
			role={isOption ? 'option' : undefined}
			aria-selected={isOption ? isSelected : undefined}
			aria-current={!isOption && isSelected ? 'true' : undefined}
			onClick={onSelect}
			className={cn(
				'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50',
				isSelected && 'bg-accent',
			)}
		>
			<SimpleTooltip
				side='right'
				content={
					<span className='flex flex-col'>
						<span>{view.statusTooltip.status}</span>
						<span className='opacity-70'>{view.statusTooltip.startedBy}</span>
					</span>
				}
			>
				<span className='mt-px flex shrink-0'>
					<ToneIcon tone={STATE_TONES[view.state]} isLabelled />
				</span>
			</SimpleTooltip>
			<span className='flex min-w-0 flex-1 flex-col gap-1'>
				<span className='flex min-w-0 items-center gap-2'>
					<span className='truncate font-medium text-foreground'>{view.scope}</span>
					{view.result && (
						<SimpleTooltip content={view.result.tooltip}>
							<span
								className={cn(
									'ml-auto shrink-0 tabular-nums',
									view.state === 'running' ? 'text-muted-foreground' : 'text-foreground',
								)}
							>
								{view.result.label}
							</span>
						</SimpleTooltip>
					)}
				</span>
				<span className='flex min-w-0 gap-1 overflow-hidden'>
					{view.chips.map((chip) => (
						<RunChip key={chip.label} chip={chip} />
					))}
					{isOutdated && (
						<SimpleTooltip content='This run tested an older version of the test'>
							<span className='inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] leading-4 text-muted-foreground'>
								<History className='size-2.5' />
								older version
							</span>
						</SimpleTooltip>
					)}
				</span>
				{view.progress !== null && (
					<span className='h-0.5 overflow-hidden rounded-full bg-muted'>
						<span
							className='block h-full bg-foreground/50 transition-[width]'
							style={{ width: `${Math.round(view.progress * 100)}%` }}
						/>
					</span>
				)}
			</span>
		</button>
	);
}

/** How the Recent runs list shows a run, judged on the user's changes for a comparison and on its best model. */
export function describeRunListItem(run: RunListSource, context: RunListContext): RunListItemView {
	const state = getRunListState(run);
	return {
		state,
		scope: context.testPath
			? describeTestPath(context.testPath)
			: describeRunTests(run.selection ?? [], context.suiteTestPaths),
		result: describeRunResult(run, state, context.mainBranch),
		progress: state === 'running' ? run.completedAttempts / Math.max(run.totalAttempts, 1) : null,
		chips: listRunChips(run, context.mainBranch),
		statusTooltip: {
			status:
				run.status === 'failed' && run.errorMessage
					? `Error: ${run.errorMessage}`
					: TONE_LABELS[STATE_TONES[state]],
			startedBy: [run.triggeredByName, getTimeAgo(new Date(run.createdAt).getTime()).humanReadable]
				.filter(Boolean)
				.join(' · '),
		},
	};
}

/** Whether a run is still going, stopped, or passed when every test it judges passed on each of their attempts. */
export function getRunListState(run: RunListSource): RunListState {
	if (isActiveRun(run)) {
		return 'running';
	}
	if (run.status === 'cancelled') {
		return 'cancelled';
	}
	if (run.status !== 'completed') {
		return 'error';
	}
	const judged = getJudgedTotals(run);
	if (!judged || judged.testCount === 0) {
		return 'empty';
	}
	if (judged.passedTests === judged.testCount) {
		return 'passed';
	}
	return isFlakyTest(run, judged) ? 'flaky' : 'failed';
}

function RunChip({ chip }: { chip: RunListChip }) {
	return (
		<span className='inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] leading-4 text-muted-foreground'>
			{chip.isComparedBranch && 'vs'}
			{chip.isBranch && <GitBranch className='size-2.5' />}
			<span className={cn(chip.isBranch && 'font-mono text-[10px] text-foreground')}>{chip.label}</span>
		</span>
	);
}

function describeRunResult(run: RunListSource, state: RunListState, mainBranch: string): RunListItemView['result'] {
	if (state === 'running') {
		return {
			label: `${Math.round((run.completedAttempts / Math.max(run.totalAttempts, 1)) * 100)}%`,
			tooltip: `${run.completedAttempts} of ${run.totalAttempts} answers checked`,
		};
	}
	if (state === 'cancelled' || state === 'error') {
		return null;
	}
	if (state === 'empty') {
		return { label: '—', tooltip: 'The run recorded no result' };
	}
	if (run.trigger === 'comparison') {
		return describeComparisonResult(run, mainBranch);
	}
	return run.models.length > 1 ? describeBenchmarkResult(run) : describeSingleModelResult(run, state);
}

function describeComparisonResult(run: RunListSource, mainBranch: string): RunListItemView['result'] {
	const before = findVariant(run, 'production');
	const after = findVariant(run, 'draft');
	if (!before || !after) {
		return null;
	}
	if (after.testCount === 1) {
		return describeSingleTestChange(before.passedTests === 1, after.passedTests === 1, mainBranch);
	}
	return {
		label: `${before.passedTests} → ${after.passedTests}`,
		tooltip: `${before.passedTests} of ${after.testCount} tests pass on ${mainBranch}, ${after.passedTests} with your changes`,
	};
}

function describeSingleTestChange(
	passedBefore: boolean,
	passesAfter: boolean,
	mainBranch: string,
): RunListItemView['result'] {
	if (passedBefore && !passesAfter) {
		return { label: 'regressed', tooltip: `Passed on ${mainBranch}, fails with your changes` };
	}
	if (!passedBefore && passesAfter) {
		return { label: 'fixed', tooltip: `Failed on ${mainBranch}, passes with your changes` };
	}
	return {
		label: 'no change',
		tooltip: `${passesAfter ? 'Passes' : 'Fails'} on ${mainBranch} and with your changes`,
	};
}

function describeBenchmarkResult(run: RunListSource): RunListItemView['result'] {
	const models = findVariant(run, getSingleRunVariant(run))?.models ?? [];
	const best = pickBestModel(models);
	if (!best) {
		return null;
	}
	if (best.testCount === 1) {
		const passingModels = models.filter((model) => model.passedTests === 1).length;
		return {
			label: `${passingModels}/${models.length} models`,
			tooltip: `Passes on ${passingModels} of ${models.length} models`,
		};
	}
	return {
		label: `best ${best.passedTests}/${best.testCount}`,
		tooltip: `Best of ${models.length} models: ${best.modelId} passed ${best.passedTests} of ${best.testCount} tests`,
	};
}

function describeSingleModelResult(run: RunListSource, state: RunListState): RunListItemView['result'] {
	const totals = findVariant(run, getSingleRunVariant(run));
	if (!totals) {
		return null;
	}
	if (state === 'flaky') {
		return { label: 'flaky', tooltip: `Passed ${totals.passedAttempts} of ${totals.totalAttempts} times` };
	}
	if (totals.testCount === 1) {
		return null;
	}
	return {
		label: `${totals.passedTests}/${totals.testCount}`,
		tooltip: `${totals.passedTests} of ${totals.testCount} tests passed`,
	};
}

function listRunChips(run: RunListSource, mainBranch: string): RunListChip[] {
	const chips: RunListChip[] = [describeBranchChip(run, mainBranch)];
	if (run.trigger === 'draft') {
		chips.push({ label: 'edited', isBranch: false });
	}
	if (run.models.length > 1) {
		chips.push({ label: `${run.models.length} models`, isBranch: false });
	}
	if (run.attempts > 1) {
		chips.push({ label: `asked ${run.attempts}×`, isBranch: false });
	}
	return chips;
}

function describeBranchChip(run: RunListSource, mainBranch: string): RunListChip {
	switch (run.trigger) {
		case 'comparison':
			return { label: mainBranch, isBranch: true, isComparedBranch: true };
		case 'changes':
			return { label: run.contextRef ?? CHANGES_FALLBACK, isBranch: true };
		default:
			return { label: mainBranch, isBranch: true };
	}
}

/** "All tests" when the run covered every test of the current suite, so a full run reads apart from a partial one. */
function describeRunTests(selection: string[], suiteTestPaths: string[] | undefined): string {
	const runTestPaths = new Set(selection);
	if (suiteTestPaths && suiteTestPaths.length > 1 && suiteTestPaths.every((path) => runTestPaths.has(path))) {
		return 'All tests';
	}
	if (selection.length === 1) {
		return describeTestPath(selection[0]);
	}
	return `${selection.length} tests`;
}

function describeTestPath(testPath: string): string {
	return testPath.replace(TEST_FILE_EXTENSION, '');
}

/** The user's changes for a comparison, the best model when several ran, else the tests over all their attempts. */
function getJudgedTotals(run: RunListSource): TestTotals | null {
	if (run.trigger === 'comparison') {
		return findVariant(run, 'draft') ?? null;
	}
	const totals = findVariant(run, getSingleRunVariant(run));
	if (!totals) {
		return null;
	}
	return run.models.length > 1 ? pickBestModel(totals.models) : totals;
}

function isFlakyTest(run: RunListSource, totals: TestTotals): boolean {
	return run.trigger !== 'comparison' && run.models.length === 1 && totals.testCount === 1 && totals.flakyTests === 1;
}

function findVariant(run: RunListSource, contextVariant: VariantTotals['contextVariant']): VariantTotals | undefined {
	return run.testTotals.find((totals) => totals.contextVariant === contextVariant);
}

function pickBestModel<Model extends TestTotals>(models: Model[]): Model | null {
	return models.reduce<Model | null>(
		(best, model) =>
			!best ||
			model.passedTests > best.passedTests ||
			(model.passedTests === best.passedTests && model.passedAttempts > best.passedAttempts)
				? model
				: best,
		null,
	);
}
