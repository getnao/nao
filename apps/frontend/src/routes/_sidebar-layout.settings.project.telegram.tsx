import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TelegramConfigSection } from '@/components/settings/telegram-config-section';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/telegram')({
	component: ProjectTelegramTabPage,
});

function ProjectTelegramTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return <TelegramConfigSection isAdmin={isAdmin} />;
}
