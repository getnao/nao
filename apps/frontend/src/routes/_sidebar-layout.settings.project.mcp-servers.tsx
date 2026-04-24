import { createFileRoute } from '@tanstack/react-router';
import { McpSettings } from '@/components/settings/display-mcp';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-servers')({
	component: ProjectMcpServersTabPage,
});

function ProjectMcpServersTabPage() {
	const { isAdmin } = usePermissions();

	return <McpSettings isAdmin={isAdmin} />;
}
