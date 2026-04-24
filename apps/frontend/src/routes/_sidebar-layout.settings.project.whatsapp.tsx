import { createFileRoute } from '@tanstack/react-router';
import { WhatsappConfigSection } from '@/components/settings/whatsapp-config-section';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/whatsapp')({
	component: ProjectWhatsappTabPage,
});

function ProjectWhatsappTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<LinkingCodesCard provider='whatsapp' />
			<WhatsappConfigSection isAdmin={isAdmin} />
		</>
	);
}
