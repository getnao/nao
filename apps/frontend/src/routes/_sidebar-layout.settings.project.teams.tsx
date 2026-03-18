import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TeamsConfigSection } from '@/components/settings/teams-config-section';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/teams')({
	component: ProjectTeamsTabPage,
});

function ProjectTeamsTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return <TeamsConfigSection isAdmin={isAdmin} />;
}
