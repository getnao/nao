import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TabBarItem } from '@/components/ui/tab-bar';
import { McpSettings } from '@/components/settings/display-mcp';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { usePermissions } from '@/hooks/use-permissions';
import { requireNonViewer } from '@/lib/require-admin';

type McpTab = 'servers' | 'endpoints';

const tabs: TabBarItem<McpTab>[] = [
	{ id: 'servers', label: 'Servers' },
	{ id: 'endpoints', label: 'Endpoints' },
];

const tabIdBase = 'project-mcp';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp')({
	staticData: {
		title: 'MCP',
	},
	beforeLoad: requireNonViewer,
	validateSearch: (search: Record<string, unknown>): { tab: McpTab } => ({
		tab: isMcpTab(search.tab) ? search.tab : 'servers',
	}),
	component: ProjectMcpPage,
});

function ProjectMcpPage() {
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
				{tab === 'servers' ? <McpSettings isAdmin={isAdmin} /> : <McpEndpointSettings isAdmin={isAdmin} />}
			</TabPanel>
		</>
	);
}

function isMcpTab(value: unknown): value is McpTab {
	return value === 'servers' || value === 'endpoints';
}
