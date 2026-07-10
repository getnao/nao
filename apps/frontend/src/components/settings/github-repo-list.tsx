import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { RepoList } from '@/components/settings/repo-list';
import { trpc } from '@/main';

export type GithubRepo = inferRouterOutputs<TrpcRouter>['github']['listRepos']['repos'][number];

interface GithubRepoListProps {
	selected: string | null;
	onSelect: (repoFullName: string) => void;
	onSearchChange?: () => void;
	renderRepoMeta?: (repo: GithubRepo) => ReactNode;
}

/** Searchable, paginated list of the connected user's GitHub repositories. */
export function GithubRepoList(props: GithubRepoListProps) {
	return (
		<RepoList<GithubRepo>
			{...props}
			searchPlaceholder='Search repositories...'
			resourceNounPlural='repositories'
			useItems={({ page, search }) => {
				const repos = useQuery({
					...trpc.github.listRepos.queryOptions({ page, search }),
					placeholderData: (prev) => prev,
				});
				return {
					data: repos.data && { items: repos.data.repos, hasMore: repos.data.hasMore },
					isLoading: repos.isLoading,
				};
			}}
			getKey={(repo) => repo.id}
			getValue={(repo) => repo.full_name}
			getLabel={(repo) => repo.full_name}
			getDescription={(repo) => repo.description}
			getUpdatedAt={(repo) => repo.updated_at}
			isPrivate={(repo) => repo.private}
		/>
	);
}
