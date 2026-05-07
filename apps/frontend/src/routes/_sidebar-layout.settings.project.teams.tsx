import { createFileRoute } from '@tanstack/react-router';
import { TeamsConfigSection } from '@/components/settings/teams-config-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/teams')({
	component: ProjectTeamsTabPage,
});

function ProjectTeamsTabPage() {
	const { isAdmin } = usePermissions();

	return <TeamsConfigSection isAdmin={isAdmin} />;
}
