import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TabBarItem } from '@/components/ui/tab-bar';

import { DefaultModelsSection } from '@/components/settings/default-models-section';
import { McpSettings } from '@/components/settings/display-mcp';
import { SettingsExcludeColumns } from '@/components/settings/exclude-columns';
import { SettingsExperimental } from '@/components/settings/experimental';
import { LlmProvidersSection } from '@/components/settings/llm-providers-section';
import { SavedPrompts } from '@/components/settings/saved-prompts';
import { SettingsDisplayMap } from '@/components/settings/display-map';
import { SettingsProjectMemory } from '@/components/settings/project-memory';
import { SettingsTranscribe } from '@/components/settings/settings-transcribe';
import { SettingsWebSearch } from '@/components/settings/web-search';
import { SettingsCard } from '@/components/ui/settings-card';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { usePermissions } from '@/hooks/use-permissions';

type AgentTab = 'models' | 'tools' | 'mcp-servers';

const tabs: TabBarItem<AgentTab>[] = [
	{ id: 'models', label: 'Models' },
	{ id: 'tools', label: 'Capabilities' },
	{ id: 'mcp-servers', label: 'MCP servers' },
];

const tabIdBase = 'project-agent';

export const Route = createFileRoute('/_sidebar-layout/settings/project/agent')({
	staticData: {
		title: 'Agent',
	},
	validateSearch: (search: Record<string, unknown>): { tab: AgentTab } => ({
		tab: search.tab === 'memory' ? 'tools' : isAgentTab(search.tab) ? search.tab : 'models',
	}),
	component: ProjectAgentPage,
});

function ProjectAgentPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { isAdmin } = usePermissions();

	return (
		<>
			<TabBar
				tabs={tabs}
				activeTab={tab}
				onTabChange={(nextTab) => {
					navigate({
						search: { tab: nextTab },
						replace: true,
					});
				}}
				idBase={tabIdBase}
				className='border-b'
			/>
			<TabPanel idBase={tabIdBase} tabId={tab} className='flex flex-col gap-12'>
				{tab === 'models' && <ModelsSettings isAdmin={isAdmin} />}
				{tab === 'tools' && <ToolsSettings isAdmin={isAdmin} />}
				{tab === 'mcp-servers' && <McpSettings isAdmin={isAdmin} />}
			</TabPanel>
		</>
	);
}

function ModelsSettings({ isAdmin }: { isAdmin: boolean }) {
	return (
		<>
			<SettingsCard
				title='LLM Configuration'
				description='Configure the LLM providers for the agent in this project.'
			>
				<LlmProvidersSection isAdmin={isAdmin} />
			</SettingsCard>
			<DefaultModelsSection isAdmin={isAdmin} />
			<SettingsTranscribe isAdmin={isAdmin} />
		</>
	);
}

function ToolsSettings({ isAdmin }: { isAdmin: boolean }) {
	return (
		<>
			<SettingsWebSearch isAdmin={isAdmin} />
			<SavedPrompts isAdmin={isAdmin} />
			{isAdmin && <SettingsProjectMemory />}
			<SettingsDisplayMap isAdmin={isAdmin} />
			<SettingsExperimental isAdmin={isAdmin} />
			<SettingsExcludeColumns isAdmin={isAdmin} />
		</>
	);
}

function isAgentTab(value: unknown): value is AgentTab {
	return value === 'models' || value === 'tools' || value === 'mcp-servers';
}
