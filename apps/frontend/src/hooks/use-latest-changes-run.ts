import { useQuery } from '@tanstack/react-query';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import { trpc } from '@/main';

/** Which runs tested a set of changes: the user's own changes on a branch, or a branch of a synced repository. */
export type ChangesRunSource =
	| { kind: 'own'; branch: string | null }
	| { kind: 'upstream'; ref: string; commit: string | null };

export interface ChangesRunResult {
	run: TestRunSummary;
	passedTests: number;
	testCount: number;
	/** The changes moved on since that run: the branch has new commits, or other files changed. */
	isOutdated: boolean;
}

/** The latest completed run that tested the changes, with how many tests passed with them. */
export function useLatestChangesRun(source: ChangesRunSource | null): ChangesRunResult | null {
	const runs = useQuery({ ...trpc.testRun.listRuns.queryOptions(), enabled: source !== null });
	const draftContext = useQuery({ ...trpc.testRun.getDraftContext.queryOptions(), enabled: source?.kind === 'own' });
	const run = source ? runs.data?.find((candidate) => isCompletedRunOf(candidate, source)) : undefined;
	const totals = run?.testTotals.find((variant) => variant.contextVariant === 'draft');
	if (!source || !run || !totals) {
		return null;
	}
	const currentDraft = draftContext.data?.status === 'available' ? draftContext.data : null;
	return {
		run,
		passedTests: totals.passedTests,
		testCount: totals.testCount,
		isOutdated: isRunOutdated(run, source, currentDraft),
	};
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

/** Edits to files the run already tested go unnoticed, as runs record which files changed, not their content. */
function isRunOutdated(run: TestRunSummary, source: ChangesRunSource, draft: DraftContext | null): boolean {
	if (source.kind === 'upstream') {
		return source.commit !== null && run.contextCommit !== source.commit;
	}
	if (!draft) {
		return false;
	}
	const testedPaths = new Set((run.contextChanges ?? []).map((change) => change.path));
	return testedPaths.size !== draft.changes.length || draft.changes.some((change) => !testedPaths.has(change.path));
}
