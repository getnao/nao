import { describe, expect, it } from 'vitest';

import { describeRunListItem, getRunListTone } from './test-run-list-item';
import type { TestRunSummary } from './test-run-types';

const SONNET = { provider: 'anthropic', modelId: 'claude-sonnet-5' };
const HAIKU = { provider: 'anthropic', modelId: 'claude-haiku-5' };
const SUITE = ['revenue.yml', 'churn.yml', 'margin.yml'];
const CONTEXT = { mainBranch: 'master', suiteTestPaths: SUITE };

type Totals = { testCount: number; passedTests: number; flakyTests?: number; passed?: number; total?: number };

describe('describeRunListItem', () => {
	it('shows a run of the whole suite with the tests that passed, on the main branch', () => {
		const view = describeRunListItem(run({ production: totals({ testCount: 3, passedTests: 2 }) }), CONTEXT);

		expect(view).toMatchObject({
			tone: 'fail',
			scope: 'All tests',
			result: { label: '2/3', tooltip: '2 of 3 tests passed' },
			chips: [{ label: 'master', isBranch: true }],
			progress: null,
		});
	});

	it('names a single test and leaves its result to the icon', () => {
		const view = describeRunListItem(
			run({ selection: ['revenue.yml'], production: totals({ testCount: 1, passedTests: 1 }) }),
			CONTEXT,
		);

		expect(view).toMatchObject({ tone: 'pass', scope: 'revenue', result: null });
	});

	it('calls a single test flaky when it passed only some of the times it was asked', () => {
		const view = describeRunListItem(
			run({
				selection: ['churn.yml'],
				attempts: 3,
				production: totals({ testCount: 1, passedTests: 0, flakyTests: 1, passed: 2, total: 3 }),
			}),
			CONTEXT,
		);

		expect(view.tone).toBe('mixed');
		expect(view.result).toEqual({ label: 'flaky', tooltip: 'Passed 2 of 3 times' });
		expect(view.chips.map((chip) => chip.label)).toEqual(['master', 'asked 3×']);
	});

	it('judges a run of several models on its best one', () => {
		const view = describeRunListItem(
			run({
				models: [HAIKU, SONNET],
				production: totals({ testCount: 3, passedTests: 1 }, [
					{ ...HAIKU, ...totals({ testCount: 3, passedTests: 1 }) },
					{ ...SONNET, ...totals({ testCount: 3, passedTests: 3 }) },
				]),
			}),
			CONTEXT,
		);

		expect(view.tone).toBe('pass');
		expect(view.result).toEqual({
			label: 'best 3/3',
			tooltip: 'Best of 2 models: claude-sonnet-5 passed 3 of 3 tests',
		});
		expect(view.chips.map((chip) => chip.label)).toEqual(['master', '2 models']);
	});

	it('compares the tests that pass on main with the ones that pass with the changes', () => {
		const view = describeRunListItem(
			run({
				trigger: 'comparison',
				production: totals({ testCount: 3, passedTests: 3 }),
				draft: totals({ testCount: 3, passedTests: 1 }),
			}),
			CONTEXT,
		);

		expect(view.tone).toBe('fail');
		expect(view.result).toEqual({
			label: '3 → 1',
			tooltip: '3 of 3 tests pass on master, 1 with your changes',
		});
		expect(view.chips).toEqual([{ label: 'master', isBranch: true, isComparedBranch: true }]);
	});

	it.each([
		[true, false, 'regressed'],
		[false, true, 'fixed'],
		[true, true, 'no change'],
	])('says how the changes moved a single compared test (passed before: %s, after: %s)', (before, after, label) => {
		const view = describeRunListItem(
			run({
				trigger: 'comparison',
				selection: ['revenue.yml'],
				production: totals({ testCount: 1, passedTests: before ? 1 : 0 }),
				draft: totals({ testCount: 1, passedTests: after ? 1 : 0 }),
			}),
			CONTEXT,
		);

		expect(view.result?.label).toBe(label);
	});

	it('shows the branch the changes come from, or "your changes" without git', () => {
		const onBranch = run({
			trigger: 'changes',
			contextRef: 'improve-revenue',
			draft: totals({ testCount: 3, passedTests: 3 }),
		});
		const withoutGit = run({
			trigger: 'changes',
			contextRef: null,
			draft: totals({ testCount: 3, passedTests: 3 }),
		});

		expect(describeRunListItem(onBranch, CONTEXT).chips[0].label).toBe('improve-revenue');
		expect(describeRunListItem(withoutGit, CONTEXT).chips[0].label).toBe('your changes');
		expect(describeRunListItem(onBranch, CONTEXT).tone).toBe('pass');
	});

	it('marks a test run as it was in the editor', () => {
		const view = describeRunListItem(
			run({ trigger: 'draft', selection: ['revenue.yml'], production: totals({ testCount: 1, passedTests: 0 }) }),
			CONTEXT,
		);

		expect(view.chips.map((chip) => chip.label)).toEqual(['master', 'edited']);
	});

	it('shows the progress of a running run', () => {
		const view = describeRunListItem(run({ status: 'running', completedAttempts: 3, totalAttempts: 12 }), CONTEXT);

		expect(view).toMatchObject({ tone: 'pending', progress: 0.25, result: { label: '25%' } });
	});

	it('leaves the result of a stopped run to its icon and explains an error in its tooltip', () => {
		const cancelled = describeRunListItem(run({ status: 'cancelled' }), CONTEXT);
		const broken = describeRunListItem(run({ status: 'failed', errorMessage: 'Warehouse unreachable' }), CONTEXT);

		expect(cancelled).toMatchObject({ tone: 'cancelled', result: null });
		expect(broken).toMatchObject({ tone: 'error', result: null });
		expect(broken.statusTooltip.status).toBe('Error: Warehouse unreachable');
	});
});

describe('getRunListTone', () => {
	it('counts a completed run without results as empty', () => {
		expect(getRunListTone(run({}))).toBe('neutral');
	});
});

function run(overrides: {
	status?: TestRunSummary['status'];
	trigger?: TestRunSummary['trigger'];
	selection?: string[];
	models?: { provider: string; modelId: string }[];
	attempts?: number;
	completedAttempts?: number;
	totalAttempts?: number;
	contextRef?: string | null;
	errorMessage?: string | null;
	production?: ReturnType<typeof totals>;
	draft?: ReturnType<typeof totals>;
}): TestRunSummary {
	const testTotals = [
		overrides.draft && { contextVariant: 'draft', ...overrides.draft },
		overrides.production && { contextVariant: 'production', ...overrides.production },
	].filter(Boolean);
	return {
		id: 'run-1',
		status: overrides.status ?? 'completed',
		trigger: overrides.trigger ?? 'manual',
		selection: overrides.selection ?? SUITE,
		models: overrides.models ?? [SONNET],
		attempts: overrides.attempts ?? 1,
		completedAttempts: overrides.completedAttempts ?? 0,
		totalAttempts: overrides.totalAttempts ?? 0,
		contextRef: overrides.contextRef ?? null,
		errorMessage: overrides.errorMessage ?? null,
		triggeredByName: 'Christophe Blefari',
		createdAt: new Date().toISOString(),
		testTotals,
	} as unknown as TestRunSummary;
}

function totals({ testCount, passedTests, flakyTests = 0, passed, total }: Totals, models: object[] = []) {
	return {
		testCount,
		passedTests,
		flakyTests,
		passedAttempts: passed ?? passedTests,
		totalAttempts: total ?? testCount,
		models,
	};
}
