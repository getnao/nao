import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { WhatsappConfigSection } from '@/components/settings/whatsapp-config-section';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/whatsapp')({
	component: ProjectWhatsappTabPage,
});

function ProjectWhatsappTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return (
		<>
			<LinkingCodesCard />
			<WhatsappConfigSection isAdmin={isAdmin} />
		</>
	);
}
