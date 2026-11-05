import { useQuery } from '@tanstack/react-query';

import type { TestHistoryRun } from '@/components/settings/test-run-types';
import { ACTIVE_RUN_REFETCH_MS, isActiveRun } from '@/components/settings/test-run-types';
import { trpc } from '@/main';

/**
 * The latest runs of a test, fetched again with the selected run when it is older than them, as when opened from a run
 * of several tests.
 */
export function useTestHistory(path: string, selectedRunId: string | null) {
	const latest = useQuery({
		...trpc.testRun.getTestHistory.queryOptions({ path }),
		refetchInterval: refetchWhileRunning,
	});
	const isSelectedRunMissing =
		selectedRunId !== null && latest.data !== undefined && !latest.data.some((run) => run.id === selectedRunId);
	const withSelectedRun = useQuery({
		...trpc.testRun.getTestHistory.queryOptions({ path, runId: selectedRunId ?? undefined }),
		refetchInterval: refetchWhileRunning,
		enabled: isSelectedRunMissing,
	});
	return isSelectedRunMissing ? withSelectedRun : latest;
}

function refetchWhileRunning(query: { state: { data?: TestHistoryRun[] } }): number | false {
	return query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false;
}
