import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/organization')({
	component: OrganizationLayout,
});

function OrganizationLayout() {
	return <Outlet />;
}
