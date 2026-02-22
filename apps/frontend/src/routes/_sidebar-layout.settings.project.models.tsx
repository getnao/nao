import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LlmProvidersSection } from '@/components/settings/llm-providers-section';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';
import { SettingsTranscribe } from '@/components/settings-transcribe';

export const Route = createFileRoute('/_sidebar-layout/settings/project/models')({
	component: ProjectModelsTabPage,
});

function ProjectModelsTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return (
		<>
			<SettingsCard
				title='LLM Configuration'
				description='Configure the LLM providers for the agent in this project.'
			>
				<LlmProvidersSection isAdmin={isAdmin} />
			</SettingsCard>
			<SettingsTranscribe isAdmin={isAdmin} />
		</>
	);
}
