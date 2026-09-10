import { createFileRoute } from '@tanstack/react-router';

import { UserGroupsTable } from '@/components/settings/user-groups-table';
import { requireAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups')({
	beforeLoad: requireAdmin,
	staticData: {
		title: 'User Groups',
	},
	component: UserGroupsPage,
});

function UserGroupsPage() {
	return <UserGroupsTable />;
}
