import { createFileRoute } from '@tanstack/react-router';
import { SavedPrompts } from '@/components/settings/saved-prompts';
import { SettingsExperimental } from '@/components/settings/experimental';
import { SettingsDisplayMap } from '@/components/settings/display-map';
import { SettingsProjectMemory } from '@/components/settings/project-memory';
import { SettingsWebSearch } from '@/components/settings/web-search';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/agent')({
	component: ProjectAgentTabPage,
});

function ProjectAgentTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<SettingsProjectMemory isAdmin={isAdmin} />
			<SettingsWebSearch isAdmin={isAdmin} />
			<SavedPrompts isAdmin={isAdmin} />
			<SettingsDisplayMap isAdmin={isAdmin} />
			<SettingsExperimental isAdmin={isAdmin} />
		</>
	);
}
