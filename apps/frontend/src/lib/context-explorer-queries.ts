import type { QueryClient } from '@tanstack/react-query';

import { trpc } from '@/main';

export async function invalidateExplorerQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.suggestBranchName.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getLiveContextPullHistory.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.readFile.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileDiff.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.searchContent.queryKey() }),
	]);
}
