import { createFileRoute } from '@tanstack/react-router';
import { SlackConfigSection } from '@/components/settings/slack-config-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/slack')({
	component: ProjectSlackTabPage,
});

function ProjectSlackTabPage() {
	const { isAdmin } = usePermissions();

	return <SlackConfigSection isAdmin={isAdmin} />;
}
