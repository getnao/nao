import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

/** The repository of the context and the files changed in it, shared by the Changes panel and the file tree. */
export function useContextChanges() {
	const repositoryStatus = useQuery({
		...trpc.contextExplorer.getRepositoryStatus.queryOptions(),
		staleTime: 30_000,
	});
	const status = repositoryStatus.data;
	const isGitAvailable = status?.gitUnavailableReason === null && status.branches !== null && status.repo !== null;
	const isNaoDraft = status?.gitUnavailableReason === 'no-repo';
	const changedFiles = useQuery({
		...trpc.contextExplorer.getChangedFiles.queryOptions(),
		enabled: isGitAvailable || isNaoDraft,
	});

	return { repositoryStatus, changedFiles, isGitAvailable, isNaoDraft };
}
