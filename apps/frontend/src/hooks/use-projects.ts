import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useActiveProjectId } from '@/stores/active-project';
import { trpc } from '@/main';

export type ProjectListItem = {
	id: string;
	name: string;
	type: string;
	path: string | null;
	gitUrl: string | null;
	gitBranch: string | null;
	createdAt: Date;
};

export function useProjects() {
	const projectsQuery = useQuery(trpc.project.list.queryOptions());
	const [activeId, setActiveId] = useActiveProjectId();

	const projects = useMemo<ProjectListItem[]>(() => projectsQuery.data ?? [], [projectsQuery.data]);
	const hasMultiple = projects.length > 1;

	const activeProject = useMemo(() => {
		if (projects.length === 0) {
			return null;
		}
		if (activeId) {
			const found = projects.find((p) => p.id === activeId);
			if (found) {
				return found;
			}
		}
		return projects[0];
	}, [projects, activeId]);

	const switchProject = useCallback(
		(projectId: string) => {
			setActiveId(projectId);
		},
		[setActiveId],
	);

	return {
		projects,
		activeProject,
		hasMultiple,
		switchProject,
		isLoading: projectsQuery.isLoading,
		refetch: projectsQuery.refetch,
	};
}
