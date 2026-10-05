import { createFileRoute, Outlet } from '@tanstack/react-router';

import { requireNonViewer } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups')({
	beforeLoad: requireNonViewer,
	component: ProjectUserGroupsLayout,
});

function ProjectUserGroupsLayout() {
	return <Outlet />;
}
