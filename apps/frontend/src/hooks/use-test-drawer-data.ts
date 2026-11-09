import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { ACTIVE_RUN_REFETCH_MS, isActiveRun } from '@/components/settings/test-run-types';
import { trpc } from '@/main';

/**
 * The runs, tests and draft the drawer needs, kept fresh: runs are polled while one is active, and what depends on
 * their outcome or on the saved files is refetched when those change. The draft loads even while the drawer is
 * collapsed, as its bar offers to compare the changes with production.
 */
export function useTestDrawerData() {
	const queryClient = useQueryClient();
	const runs = useQuery({
		...trpc.testRun.listRuns.queryOptions(),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const draftContext = useQuery(trpc.testRun.getDraftContext.queryOptions());
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const changedFilesUpdatedAt = useQuery({
		...trpc.contextExplorer.getChangedFiles.queryOptions(),
		enabled: false,
	}).dataUpdatedAt;
	const activeRun = runs.data?.find(isActiveRun);
	const previousActiveRunId = useRef(activeRun?.id);

	useEffect(() => {
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.getDraftContext.queryKey() });
	}, [changedFilesUpdatedAt, queryClient]);

	useEffect(() => {
		if (previousActiveRunId.current && previousActiveRunId.current !== activeRun?.id) {
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.listTests.queryKey() });
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.getTestHistory.queryKey() });
			void queryClient.invalidateQueries({ queryKey: trpc.testRun.getRun.queryKey() });
		}
		previousActiveRunId.current = activeRun?.id;
	}, [activeRun?.id, queryClient]);

	const invalidateRuns = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.listRuns.queryKey() });
		void queryClient.invalidateQueries({ queryKey: trpc.testRun.getTestHistory.queryKey() });
	}, [queryClient]);

	return {
		runs: runs.data,
		activeRun,
		draft: draftContext.data?.status === 'available' ? draftContext.data : null,
		tests: suite.data?.tests,
		invalidateRuns,
	};
}
