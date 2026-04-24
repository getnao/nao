import { createFileRoute } from '@tanstack/react-router';
import { LlmProvidersSection } from '@/components/settings/llm-providers-section';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsTranscribe } from '@/components/settings/settings-transcribe';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/models')({
	component: ProjectModelsTabPage,
});

function ProjectModelsTabPage() {
	const { isAdmin } = usePermissions();

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
