import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SlackConfigSection } from '@/components/settings/slack-config-section';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/slack')({
	component: ProjectSlackTabPage,
});

function ProjectSlackTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return <SlackConfigSection isAdmin={isAdmin} />;
}
