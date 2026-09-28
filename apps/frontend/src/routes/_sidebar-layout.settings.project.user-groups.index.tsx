import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { UserGroupsPageTab } from '@/components/settings/user-groups-table';
import { resolveUserGroupsPageTab, UserGroupsTable } from '@/components/settings/user-groups-table';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups/')({
	staticData: {
		title: 'User Groups',
	},
	validateSearch: (search: Record<string, unknown>): { tab: UserGroupsPageTab } => ({
		tab: resolveUserGroupsPageTab(search.tab),
	}),
	component: UserGroupsPage,
});

function UserGroupsPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	return (
		<UserGroupsTable
			tab={tab}
			onTabChange={(nextTab) => {
				void navigate({
					search: { tab: nextTab },
					replace: true,
				});
			}}
		/>
	);
}
