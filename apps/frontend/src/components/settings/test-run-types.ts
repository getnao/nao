import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { KeyboardEvent } from 'react';

type TestRunOutputs = inferRouterOutputs<TrpcRouter>['testRun'];

export type TestSuiteListing = TestRunOutputs['listTests'];
export type TestDefinition = TestSuiteListing['tests'][number];
export type LatestTestOutcome = TestSuiteListing['latestOutcomes'][string];
export type TestRunSummary = TestRunOutputs['listRuns'][number];
export type TestRunWithResults = TestRunOutputs['getRun'];
export type TestRunResult = TestRunWithResults['results'][number];
export type TestComparison = NonNullable<TestRunWithResults['comparison']>;
export type TestComparisonRow = TestComparison['tests'][number];
export type TestComparisonChange = TestComparisonRow['change'];
export type DraftContextStatus = TestRunOutputs['getDraftContext'];
export type DraftContext = Extract<DraftContextStatus, { status: 'available' }>;
export type TestHistoryRun = TestRunOutputs['getTestHistory'][number];
export type TestDataDiff = NonNullable<TestRunResult['dataDiff']>;
export type TestDataDiffRow = TestDataDiff['rows'][number];
export type TestFileValidation = TestRunOutputs['validateTestFile'];

export function isActiveRun(run: Pick<TestRunSummary, 'status'>): boolean {
	return run.status === 'queued' || run.status === 'running';
}

/** The changed files that are context, as edited tests alone answer the same on production and on the draft. */
export function getContextChanges(draft: DraftContext | null): DraftContext['changes'] {
	return draft?.changes.filter((change) => !change.path.startsWith('tests/')) ?? [];
}

export function toExplorerTestPath(testPath: string): string {
	return `/tests/${testPath}`;
}

/** Whether the explorer path is a test definition, mirroring the files `nao test` discovers. */
export function isTestFilePath(filePath: string): boolean {
	const segments = filePath.replaceAll('\\', '/').replace(/^\/+/, '').split('/');
	const fileName = segments.at(-1) ?? '';
	return (
		segments.length > 1 &&
		segments[0] === 'tests' &&
		!segments.slice(1, -1).includes('outputs') &&
		/\.ya?ml$/.test(fileName)
	);
}

export function formatPassRate(passed: number, total: number): string {
	return total === 0 ? '—' : `${Math.round((passed / total) * 100)}%`;
}

export function formatCost(cost: number | null | undefined): string {
	return cost === null || cost === undefined ? '—' : `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

/** Activates a clickable row from the keyboard, like a button. */
export function onEnterOrSpace(activate: () => void) {
	return (event: KeyboardEvent) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			activate();
		}
	};
}
