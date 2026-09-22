import { createFileRoute, Outlet } from '@tanstack/react-router';

import { requireAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups')({
	beforeLoad: requireAdmin,
	component: ProjectUserGroupsLayout,
});

function ProjectUserGroupsLayout() {
	return <Outlet />;
}
