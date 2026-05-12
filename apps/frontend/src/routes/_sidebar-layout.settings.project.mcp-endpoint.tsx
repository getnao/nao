import { createFileRoute } from '@tanstack/react-router';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { usePermissions } from '@/hooks/use-permissions';
import { requireNonViewer } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mcp-endpoint')({
	beforeLoad: requireNonViewer,
	component: ProjectMcpEndpointPage,
});

function ProjectMcpEndpointPage() {
	const { isAdmin } = usePermissions();

	return <McpEndpointSettings isAdmin={isAdmin} />;
}
