import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/mcp-endpoint')({
	component: McpEndpointPage,
});

function McpEndpointPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const allProjects = useQuery(trpc.project.listForCurrentUser.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return (
		<SettingsPageWrapper>
			<McpEndpointSettings isAdmin={isAdmin} projects={allProjects.data ?? []} />
		</SettingsPageWrapper>
	);
}
