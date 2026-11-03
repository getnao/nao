import type { TestHistoryRun } from '@/components/settings/test-run-types';
import { isActiveRun, isSameTestModel, resultModel } from '@/components/settings/test-run-types';

export type Tone = 'pass' | 'fail' | 'mixed' | 'pending' | 'neutral';

export interface RunVerdict {
	tone: Tone;
	title: string;
	detail: string | null;
}

type VariantOutcome = NonNullable<TestHistoryRun['comparison']>['production'];

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

/** A side without a recorded attempt is still pending while the run is active, and left unfinished once it stopped. */
export function variantTone(run: TestHistoryRun, outcome: VariantOutcome | undefined): Tone {
	if (!outcome || outcome.total === 0) {
		return isActiveRun(run) ? 'pending' : 'neutral';
	}
	return outcomeTone(outcome.passed, outcome.total);
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
	switch (comparison.change) {
		case 'regressed':
			return { tone: 'fail', title: 'Broken by your changes', detail: null };
		case 'worsened':
			return { tone: 'fail', title: 'Less reliable with your changes', detail: null };
		case 'fixed':
			return { tone: 'pass', title: 'Fixed by your changes', detail: null };
		case 'improved':
			return { tone: 'pass', title: 'More reliable with your changes', detail: null };
		case 'unchanged':
			return describeUnchanged(outcomeTone(comparison.draft.passed, comparison.draft.total));
		case 'pending':
			return { tone: 'neutral', title: 'Incomplete', detail: null };
	}
}

function describeUnchanged(tone: Tone): RunVerdict {
	const titles: Partial<Record<Tone, string>> = { pass: 'Passes on both', fail: 'Fails on both' };
	return { tone, title: titles[tone] ?? 'Same results on both', detail: null };
}
