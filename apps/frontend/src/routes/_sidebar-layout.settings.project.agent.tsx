import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SavedPrompts } from '@/components/settings/saved-prompts';
import { SettingsExperimental } from '@/components/settings/experimental';
import { SettingsProjectMemory } from '@/components/settings/project-memory';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/agent')({
	component: ProjectAgentTabPage,
});

function ProjectAgentTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return (
		<>
			<SettingsProjectMemory isAdmin={isAdmin} />
			<SavedPrompts isAdmin={isAdmin} />
			<SettingsExperimental isAdmin={isAdmin} />
		</>
	);
}
