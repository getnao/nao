import { isSameTestModel, testResultModel } from '@nao/backend/test-run';
import { Tag, X } from 'lucide-react';
import { useState } from 'react';

import type { TestModel } from '@nao/backend/test-run';
import type { ReactNode } from 'react';

import type { TestResultOutcome, TestRunWithResults } from '@/components/settings/test-run-types';
import { ModelName } from '@/components/settings/test-model-labels';
import { BranchName } from '@/components/settings/test-run-labels';
import {
	average,
	formatDuration,
	formatPassRate,
	formatUnitCost,
	getSingleRunVariant,
	groupResultsByTest,
	onEnterOrSpace,
	testModelKey,
} from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

/** Groups the tests that have no tag, so that they still show next to the tagged ones. */
export const UNTAGGED = '';

const MAX_MODEL_COLUMNS = 4;
const COLLAPSED_TAG_COUNT = 8;

interface AttemptCount {
	passedAttempts: number;
	totalAttempts: number;
}

export interface TagSummary extends AttemptCount {
	tag: string;
	testCount: number;
	/** Tests where every expected answer passed. */
	passedTests: number;
	/** Each model on the tests of the tag, in the order of the run. */
	models: (AttemptCount & { model: TestModel })[];
	/** The same tests on the main branch, in a comparison. */
	baseline: AttemptCount | null;
	costPerQuestion: number | null;
	durationMs: number | null;
}

/**
 * How the tests of each tag did in a run, the weakest tag first, so that teams who use tags as domains see which of
 * theirs the agent gets wrong. A test with several tags counts in each of them.
 */
export function TestTagBreakdown({
	run,
	mainBranch,
	selectedTag,
	onSelectTag,
}: {
	run: TestRunWithResults;
	mainBranch: string;
	selectedTag: string | null;
	onSelectTag: (tag: string | null) => void;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const summaries = summarizeRunByTag(run);
	if (!summaries.some((summary) => summary.tag !== UNTAGGED)) {
		return null;
	}
	const modelColumns = run.comparison || run.models.length > MAX_MODEL_COLUMNS ? [] : run.models;
	const hasSeveralModels = modelColumns.length > 1;
	const shownSummaries =
		isExpanded || summaries.length <= COLLAPSED_TAG_COUNT ? summaries : summaries.slice(0, COLLAPSED_TAG_COUNT);
	return (
		<div className='border-b'>
			<table className='w-full text-xs'>
				<thead>
					<tr className='text-left text-[11px] text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]'>
						<th className='px-3 py-1.5 font-medium'>Tag</th>
						<th className='px-3 py-1.5 text-right font-medium'>Tests</th>
						<th className='px-3 py-1.5 text-right font-medium' title='Tests where every answer passed'>
							Passed
						</th>
						{run.comparison && (
							<th className='px-3 py-1.5 font-medium'>
								<BranchName name={mainBranch} />
							</th>
						)}
						<th className='px-3 py-1.5 font-medium' title='Share of the answers that passed'>
							{run.comparison ? 'Yours' : 'Accuracy'}
						</th>
						{hasSeveralModels &&
							modelColumns.map((model) => (
								<th key={testModelKey(model)} className='px-3 py-1.5 font-medium'>
									<ModelName models={run.models} model={model} />
								</th>
							))}
						<th className='px-3 py-1.5 text-right font-medium'>$ / question</th>
						<th className='px-3 py-1.5 text-right font-medium'>Time</th>
					</tr>
				</thead>
				<tbody>
					{shownSummaries.map((summary) => (
						<TagRow
							key={summary.tag}
							summary={summary}
							modelColumns={hasSeveralModels ? modelColumns : []}
							isSelected={summary.tag === selectedTag}
							onToggle={() => onSelectTag(summary.tag === selectedTag ? null : summary.tag)}
						/>
					))}
				</tbody>
			</table>
			{summaries.length > COLLAPSED_TAG_COUNT && (
				<button
					type='button'
					onClick={() => setIsExpanded((expanded) => !expanded)}
					className='w-full cursor-pointer border-t px-3 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground'
				>
					{isExpanded ? 'Show fewer tags' : `Show all ${summaries.length} tags`}
				</button>
			)}
		</div>
	);
}

/** The tag a run's tests are filtered on, which clears it. */
export function SelectedTagChip({ tag, onClear }: { tag: string; onClear: () => void }) {
	return (
		<button
			type='button'
			onClick={onClear}
			title='Show the tests of every tag'
			className='flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-accent py-0.5 pr-1 pl-1.5 text-foreground'
		>
			<Tag className='size-3 text-muted-foreground' />
			{formatTag(tag)}
			<X className='size-3 text-muted-foreground' />
		</button>
	);
}

export function summarizeRunByTag(run: TestRunWithResults): TagSummary[] {
	const measuredVariant = run.comparison ? 'draft' : getSingleRunVariant(run);
	const expectedAttempts = run.models.length * run.attempts;
	const testsByTag = groupTestsByTag(run.results);
	const oneSidedTestPaths = listOneSidedTestPaths(run);
	const summaries = [...testsByTag].map(([tag, testResults]) => {
		const comparedResults = testResults.filter((results) => !oneSidedTestPaths.has(results[0].testPath));
		const measured = comparedResults.flatMap((results) =>
			results.filter((result) => result.contextVariant === measuredVariant),
		);
		const baseline = comparedResults.flatMap((results) =>
			results.filter((result) => result.contextVariant === 'production'),
		);
		return {
			tag,
			testCount: testResults.length,
			passedTests: testResults.filter((results) =>
				isPassedTest(
					results.filter((result) => result.contextVariant === measuredVariant),
					expectedAttempts,
				),
			).length,
			...countAttempts(measured),
			models: run.models.map((model) => ({
				model,
				...countAttempts(measured.filter((result) => isSameTestModel(testResultModel(result), model))),
			})),
			baseline: run.comparison ? countAttempts(baseline) : null,
			costPerQuestion: average(measured.map((result) => result.totalCost)),
			durationMs: average(measured.map((result) => result.durationMs)),
		};
	});
	return summaries.sort(compareTagSummaries);
}

export function hasTag(results: Pick<TestResultOutcome, 'tags'>[], tag: string): boolean {
	const tags = results.at(0)?.tags ?? [];
	return tag === UNTAGGED ? tags.length === 0 : tags.includes(tag);
}

function TagRow({
	summary,
	modelColumns,
	isSelected,
	onToggle,
}: {
	summary: TagSummary;
	modelColumns: TestModel[];
	isSelected: boolean;
	onToggle: () => void;
}) {
	const bestModel = pickBestModel(summary);
	return (
		<tr
			tabIndex={0}
			aria-pressed={isSelected}
			title={isSelected ? 'Show the tests of every tag' : `Show only the tests tagged ${formatTag(summary.tag)}`}
			onClick={onToggle}
			onKeyDown={onEnterOrSpace(onToggle)}
			className={cn(
				'cursor-pointer border-b transition-colors last:border-b-0 hover:bg-accent/50',
				isSelected && 'bg-accent',
			)}
		>
			<td className='px-3 py-1.5'>
				<span
					className={cn(
						'inline-flex max-w-48 items-center gap-1 truncate',
						summary.tag === UNTAGGED ? 'text-muted-foreground italic' : 'font-medium',
					)}
				>
					<Tag className='size-3 shrink-0 text-muted-foreground' />
					{formatTag(summary.tag)}
				</span>
			</td>
			<td className='px-3 py-1.5 text-right tabular-nums'>{summary.testCount}</td>
			<td className='px-3 py-1.5 text-right text-muted-foreground tabular-nums'>
				{summary.passedTests}/{summary.testCount}
			</td>
			{summary.baseline && (
				<td className='px-3 py-1.5'>
					<AccuracyCell {...summary.baseline} />
				</td>
			)}
			<td className='px-3 py-1.5'>
				<AccuracyCell {...summary} change={describeChange(summary)} />
			</td>
			{modelColumns.map((model) => (
				<td key={testModelKey(model)} className='px-3 py-1.5 tabular-nums'>
					<ModelAccuracy
						summary={summary}
						model={model}
						isBest={bestModel !== null && isSameTestModel(bestModel, model)}
					/>
				</td>
			))}
			<td className='px-3 py-1.5 text-right tabular-nums'>{formatUnitCost(summary.costPerQuestion)}</td>
			<td className='px-3 py-1.5 text-right tabular-nums'>{formatDuration(summary.durationMs)}</td>
		</tr>
	);
}

function AccuracyCell({ passedAttempts, totalAttempts, change }: AttemptCount & { change?: ReactNode }) {
	const accuracy = totalAttempts === 0 ? null : passedAttempts / totalAttempts;
	return (
		<span className='flex items-center gap-2 tabular-nums'>
			<span className='h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted'>
				{accuracy !== null && (
					<span
						className={cn('block h-full', accuracyColor(accuracy))}
						style={{ width: `${accuracy * 100}%` }}
					/>
				)}
			</span>
			<span className='w-9'>{formatPassRate(passedAttempts, totalAttempts)}</span>
			{change}
		</span>
	);
}

function ModelAccuracy({ summary, model, isBest }: { summary: TagSummary; model: TestModel; isBest: boolean }) {
	const modelCount = summary.models.find((entry) => isSameTestModel(entry.model, model));
	if (!modelCount || modelCount.totalAttempts === 0) {
		return <span className='text-muted-foreground'>—</span>;
	}
	return (
		<span
			className={cn(isBest && 'font-semibold text-green-700 dark:text-green-400')}
			title={`${modelCount.passedAttempts} of ${modelCount.totalAttempts} answers passed`}
		>
			{formatPassRate(modelCount.passedAttempts, modelCount.totalAttempts)}
		</span>
	);
}

/** The points the user's changes moved the accuracy of a tag by, in a comparison. */
function describeChange(summary: TagSummary): ReactNode {
	const { baseline } = summary;
	if (!baseline || baseline.totalAttempts === 0 || summary.totalAttempts === 0) {
		return null;
	}
	const points = Math.round(
		(summary.passedAttempts / summary.totalAttempts - baseline.passedAttempts / baseline.totalAttempts) * 100,
	);
	if (points === 0) {
		return null;
	}
	return (
		<span className={cn('font-medium', points > 0 ? 'text-green-700 dark:text-green-400' : 'text-destructive')}>
			{points > 0 ? '+' : ''}
			{points} pts
		</span>
	);
}

/** The model that answered the tests of a tag best, null when no model stands out. */
function pickBestModel(summary: TagSummary): TestModel | null {
	const ranked = summary.models
		.filter((entry) => entry.totalAttempts > 0)
		.map((entry) => ({ model: entry.model, accuracy: entry.passedAttempts / entry.totalAttempts }))
		.sort((left, right) => right.accuracy - left.accuracy);
	const [best, runnerUp] = ranked;
	return best && runnerUp && best.accuracy > runnerUp.accuracy ? best.model : null;
}

function accuracyColor(accuracy: number): string {
	if (accuracy >= 0.8) {
		return 'bg-green-600 dark:bg-green-500';
	}
	if (accuracy >= 0.5) {
		return 'bg-amber-500';
	}
	return 'bg-destructive';
}

function formatTag(tag: string): string {
	return tag === UNTAGGED ? 'No tag' : tag;
}

/** The results of each test under each of its tags, the untagged tests under their own group. */
function groupTestsByTag(results: TestResultOutcome[]): Map<string, TestResultOutcome[][]> {
	const testsByTag = new Map<string, TestResultOutcome[][]>();
	for (const testResults of groupResultsByTest(results).values()) {
		const tags = testResults[0].tags.length > 0 ? [...new Set(testResults[0].tags)] : [UNTAGGED];
		for (const tag of tags) {
			testsByTag.set(tag, [...(testsByTag.get(tag) ?? []), testResults]);
		}
	}
	return testsByTag;
}

/**
 * Tests the user's changes added or deleted have an answer on one side only, so they would move the accuracy of their
 * tag for nothing.
 */
function listOneSidedTestPaths(run: TestRunWithResults): Set<string> {
	const oneSidedTests = run.comparison?.tests.filter((test) => test.change === 'new' || test.change === 'removed');
	return new Set((oneSidedTests ?? []).map((test) => test.testPath));
}

function isPassedTest(results: Pick<TestResultOutcome, 'passed'>[], expectedAttempts: number): boolean {
	return results.length >= Math.max(expectedAttempts, 1) && results.every((result) => result.passed);
}

function countAttempts(results: Pick<TestResultOutcome, 'passed'>[]): AttemptCount {
	return { passedAttempts: results.filter((result) => result.passed).length, totalAttempts: results.length };
}

/** The weakest tag first, the tags still waiting for an answer and the untagged tests last. */
function compareTagSummaries(left: TagSummary, right: TagSummary): number {
	if ((left.tag === UNTAGGED) !== (right.tag === UNTAGGED)) {
		return left.tag === UNTAGGED ? 1 : -1;
	}
	const rank = (summary: TagSummary) =>
		summary.totalAttempts === 0 ? 2 : summary.passedAttempts / summary.totalAttempts;
	return rank(left) - rank(right) || left.tag.localeCompare(right.tag);
}
