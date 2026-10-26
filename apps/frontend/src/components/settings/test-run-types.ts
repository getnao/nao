import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

type TestRunOutputs = inferRouterOutputs<TrpcRouter>['testRun'];

export type TestSuiteListing = TestRunOutputs['listTests'];
export type TestDefinition = TestSuiteListing['tests'][number];
export type LatestTestOutcome = TestSuiteListing['latestOutcomes'][string];
export type TestRunSummary = TestRunOutputs['listRuns'][number];
export type TestRunWithResults = TestRunOutputs['getRun'];
export type TestRunResult = TestRunWithResults['results'][number];

export function isActiveRun(run: Pick<TestRunSummary, 'status'>): boolean {
	return run.status === 'queued' || run.status === 'running';
}

export function formatPassRate(passed: number, total: number): string {
	return total === 0 ? '—' : `${Math.round((passed / total) * 100)}%`;
}

export function formatCost(cost: number | null | undefined): string {
	return cost ? `$${cost.toFixed(cost < 1 ? 4 : 2)}` : '—';
}
