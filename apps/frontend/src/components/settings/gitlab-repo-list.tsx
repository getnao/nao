import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { RepoList } from '@/components/settings/repo-list';
import { trpc } from '@/main';

export type GitlabProject = inferRouterOutputs<TrpcRouter>['gitlab']['listProjects']['projects'][number];

interface GitlabRepoListProps {
	selected: string | null;
	onSelect: (projectPathWithNamespace: string) => void;
	onSearchChange?: () => void;
	renderRepoMeta?: (project: GitlabProject) => ReactNode;
}

/** Searchable, paginated list of the connected user's GitLab projects. */
export function GitlabRepoList(props: GitlabRepoListProps) {
	return (
		<RepoList<GitlabProject>
			{...props}
			searchPlaceholder='Search projects...'
			resourceNounPlural='projects'
			useItems={({ page, search }) => {
				const projects = useQuery({
					...trpc.gitlab.listProjects.queryOptions({ page, search }),
					placeholderData: (prev) => prev,
				});
				return {
					data: projects.data && { items: projects.data.projects, hasMore: projects.data.hasMore },
					isLoading: projects.isLoading,
				};
			}}
			getKey={(project) => project.id}
			getValue={(project) => project.path_with_namespace}
			getLabel={(project) => project.path_with_namespace}
			getDescription={(project) => project.description}
			getUpdatedAt={(project) => project.last_activity_at}
			isPrivate={(project) => project.visibility === 'private'}
		/>
	);
}
