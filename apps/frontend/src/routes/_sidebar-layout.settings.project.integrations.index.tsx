import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import type { TabBarItem } from '@/components/ui/tab-bar';

import type { IntegrationId } from '@/components/settings/integrations';
import { McpSettings } from '@/components/settings/display-mcp';
import { isIntegrationId } from '@/components/settings/integrations';
import { IntegrationsPage } from '@/components/settings/integrations-page';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { usePermissions } from '@/hooks/use-permissions';

type IntegrationsTab = 'integrations' | 'nao-mcp' | 'mcp-servers';

const tabs: TabBarItem<IntegrationsTab>[] = [
	{ id: 'integrations', label: 'Integrations' },
	{ id: 'nao-mcp', label: 'nao MCP' },
	{ id: 'mcp-servers', label: 'MCP servers' },
];

const tabIdBase = 'project-integrations';

export const Route = createFileRoute('/_sidebar-layout/settings/project/integrations/')({
	staticData: {
		title: 'Integrations & MCP',
		description: 'Connect nao to chat tools and AI clients',
	},
	validateSearch: (search: Record<string, unknown>): { tab: IntegrationsTab; integration?: IntegrationId } => ({
		tab: isIntegrationsTab(search.tab) ? search.tab : 'integrations',
		integration: isIntegrationId(search.integration) ? search.integration : undefined,
	}),
	beforeLoad: ({ search }) => {
		if (search.integration) {
			throw redirect({
				to: '/settings/project/integrations/$integrationId',
				params: { integrationId: search.integration },
			});
		}
	},
	component: ProjectIntegrationsPage,
});

function ProjectIntegrationsPage() {
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
				{tab === 'integrations' && <IntegrationsPage />}
				{tab === 'nao-mcp' && <McpEndpointSettings isAdmin={isAdmin} />}
				{tab === 'mcp-servers' && <McpSettings isAdmin={isAdmin} />}
			</TabPanel>
		</>
	);
}

function isIntegrationsTab(value: unknown): value is IntegrationsTab {
	return value === 'integrations' || value === 'nao-mcp' || value === 'mcp-servers';
}
