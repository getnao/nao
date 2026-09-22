import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/project/integrations')({
	component: ProjectIntegrationsLayout,
});

function ProjectIntegrationsLayout() {
	return <Outlet />;
}
