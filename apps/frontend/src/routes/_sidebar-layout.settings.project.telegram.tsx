import { createFileRoute } from '@tanstack/react-router';
import { TelegramConfigSection } from '@/components/settings/telegram-config-section';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/telegram')({
	component: ProjectTelegramTabPage,
});

function ProjectTelegramTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<TelegramConfigSection isAdmin={isAdmin} />
			<LinkingCodesCard provider='telegram' />
		</>
	);
}
