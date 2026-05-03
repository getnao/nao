import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-endpoint')({
	component: ProjectMcpEndpointPage,
});

function ProjectMcpEndpointPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return <McpEndpointSettings isAdmin={isAdmin} />;
}
