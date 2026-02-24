import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { McpSettings } from '@/components/settings/display-mcp';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-servers')({
	component: ProjectMcpServersTabPage,
});

function ProjectMcpServersTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	return <McpSettings isAdmin={isAdmin} />;
}
