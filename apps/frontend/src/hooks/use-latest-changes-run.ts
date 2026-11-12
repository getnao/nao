import { useQuery } from '@tanstack/react-query';

import type { TestRunSummary } from '@/components/settings/test-run-types';
import { trpc } from '@/main';

/** Which runs tested a set of changes: the user's own changes on a branch, or a branch of a synced repository. */
export type ChangesRunSource = { kind: 'own'; branch: string | null } | { kind: 'upstream'; ref: string };

export interface ChangesRunResult {
	run: TestRunSummary;
	passedTests: number;
	testCount: number;
}

/** The latest completed run that tested the changes, with how many tests passed with them. */
export function useLatestChangesRun(source: ChangesRunSource | null): ChangesRunResult | null {
	const runs = useQuery({ ...trpc.testRun.listRuns.queryOptions(), enabled: source !== null });
	const run = source ? runs.data?.find((candidate) => isCompletedRunOf(candidate, source)) : undefined;
	const totals = run?.testTotals.find((variant) => variant.contextVariant === 'draft');
	return run && totals ? { run, passedTests: totals.passedTests, testCount: totals.testCount } : null;
}

function isCompletedRunOf(run: TestRunSummary, source: ChangesRunSource): boolean {
	if (run.status !== 'completed' || (run.trigger !== 'comparison' && run.trigger !== 'changes')) {
		return false;
	}
	if (source.kind === 'upstream') {
		return run.contextRef === source.ref;
	}
	const isUpstreamRun = run.contextRef?.includes(':') ?? false;
	return !isUpstreamRun && (source.branch === null || run.contextRef === source.branch);
}
