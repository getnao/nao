import { isSameTestModel, testResultModel } from '@nao/backend/test-run';

import type {
	TestComparisonChange,
	TestHistoryRun,
	TestRunSummary,
	VariantOutcome,
} from '@/components/settings/test-run-types';
import { formatTestModel, isActiveRun } from '@/components/settings/test-run-types';

export type Tone = 'pass' | 'fail' | 'mixed' | 'pending' | 'neutral' | 'cancelled' | 'error';

interface RunVerdict {
	tone: Tone;
	title: string;
	detail: string | null;
}

/** How the user's changes moved a test: a short label for a row of a comparison, a title for the run verdict. */
export const COMPARISON_CHANGES: Record<TestComparisonChange, { tone: Tone; label: string; title: string }> = {
	regressed: { tone: 'fail', label: 'Regressed', title: 'Broken by your changes' },
	worsened: { tone: 'fail', label: 'Less reliable', title: 'Less reliable with your changes' },
	fixed: { tone: 'pass', label: 'Fixed', title: 'Fixed by your changes' },
	improved: { tone: 'pass', label: 'More reliable', title: 'More reliable with your changes' },
	unchanged: { tone: 'neutral', label: 'No change', title: 'Same results on both' },
	pending: { tone: 'neutral', label: 'Incomplete', title: 'Incomplete' },
};

/**
 * What a run says about the test, in a few words, from the attempts recorded so far. A comparison says nothing more,
 * as the outcome of each side shows next to it.
 */
export function describeRun(run: TestHistoryRun): RunVerdict {
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
	return describeAttempts(run);
}

/** Attempts not recorded yet are still pending while the run is active, and left unfinished once it stopped. */
export function variantTone(run: Pick<TestRunSummary, 'status'>, outcome: VariantOutcome | undefined): Tone {
	if (!outcome || outcome.totalAttempts === 0) {
		return isActiveRun(run) ? 'pending' : 'neutral';
	}
	return outcomeTone(outcome.passedAttempts, outcome.totalAttempts);
}

export function outcomeTone(passed: number, total: number): Tone {
	if (total === 0) {
		return 'pending';
	}
	return passed === total ? 'pass' : passed === 0 ? 'fail' : 'mixed';
}

function describeAttempts(run: TestHistoryRun): RunVerdict {
	const passed = run.results.filter((result) => result.passed).length;
	const total = run.results.length;
	if (total === 0) {
		return { tone: 'neutral', title: 'No result', detail: 'The run recorded no attempt for this test.' };
	}
	if (passed === total) {
		return { tone: 'pass', title: 'Passed', detail: null };
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
		const results = run.results.filter((result) => isSameTestModel(testResultModel(result), model));
		return { model, passed: results.filter((result) => result.passed).length, total: results.length };
	});
	const passingCount = outcomes.filter((outcome) => outcome.total > 0 && outcome.passed === outcome.total).length;
	const failing = outcomes
		.filter((outcome) => outcome.passed < outcome.total)
		.map((outcome) => formatTestModel(outcome.model));
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
	if (comparison.change === 'unchanged') {
		return describeUnchanged(outcomeTone(comparison.draft.passedAttempts, comparison.draft.totalAttempts));
	}
	const { tone, title } = COMPARISON_CHANGES[comparison.change];
	return { tone, title, detail: null };
}

function describeUnchanged(tone: Tone): RunVerdict {
	const titles: Partial<Record<Tone, string>> = { pass: 'Passes on both', fail: 'Fails on both' };
	return { tone, title: titles[tone] ?? COMPARISON_CHANGES.unchanged.title, detail: null };
}
