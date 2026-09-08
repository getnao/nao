import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';

import type { UserGroupEditorTab } from '@/components/settings/user-group-editor';
import { UserGroupEditor } from '@/components/settings/user-group-editor';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups/$groupId')({
	validateSearch: (search: Record<string, unknown>): { tab: UserGroupEditorTab } => ({
		tab: isUserGroupEditorTab(search.tab) ? search.tab : 'features',
	}),
	component: UserGroupDetailPage,
});

function UserGroupDetailPage() {
	const { groupId } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = Route.useNavigate();
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const group = groupId === 'new' ? 'new' : overview.data?.groups.find((candidate) => candidate.id === groupId);

	useEffect(() => {
		if (groupId !== 'new' && overview.data && !group) {
			void navigate({
				to: '/settings/project/user-groups',
				search: { tab: 'groups' },
				replace: true,
			});
		}
	}, [group, groupId, navigate, overview.data]);

	if (overview.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading group...</div>;
	}
	if (overview.isError) {
		return <div className='text-sm text-destructive'>Failed to load User Groups.</div>;
	}
	if (!group) {
		return null;
	}

	const navigateToList = () => {
		void navigate({
			to: '/settings/project/user-groups',
			search: { tab: 'groups' },
		});
	};

	return (
		<div className='flex flex-col gap-6'>
			<Link
				to='/settings/project/user-groups'
				search={{ tab: 'groups' }}
				className='inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
			>
				<ChevronLeft className='size-3.5' />
				User Groups
			</Link>
			<h2 className='text-lg font-semibold text-foreground'>{group === 'new' ? 'New group' : group.name}</h2>
			<UserGroupEditor
				group={group}
				activeTab={tab}
				onTabChange={(nextTab) => {
					void navigate({
						search: { tab: nextTab },
						replace: true,
					});
				}}
				onCancelNew={navigateToList}
				onCreated={(createdGroup) => {
					void navigate({
						to: '/settings/project/user-groups/$groupId',
						params: { groupId: createdGroup.id },
						search: { tab },
						replace: true,
					});
				}}
				onDeleted={navigateToList}
			/>
		</div>
	);
}

function isUserGroupEditorTab(value: unknown): value is UserGroupEditorTab {
	return value === 'features' || value === 'context' || value === 'security';
}
