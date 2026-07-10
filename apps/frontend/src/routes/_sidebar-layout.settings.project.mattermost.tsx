import { createFileRoute } from '@tanstack/react-router';
import { MattermostConfigSection } from '@/components/settings/mattermost-config-section';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mattermost')({
	component: ProjectMattermostTabPage,
});

function ProjectMattermostTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<MattermostConfigSection isAdmin={isAdmin} />
			<LinkingCodesCard provider='mattermost' />
		</>
	);
}
