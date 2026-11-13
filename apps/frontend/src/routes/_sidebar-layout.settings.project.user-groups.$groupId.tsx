import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';

import type { UserGroupEditorTab } from '@/components/settings/user-group-editor';
import { UserGroupEditor } from '@/components/settings/user-group-editor';
import { requireAdmin } from '@/lib/route-guards';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups/$groupId')({
	beforeLoad: requireAdmin,
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
	const managementStatus = useQuery(trpc.userGroup.managementStatus.queryOptions());
	const group = groupId === 'new' ? 'new' : overview.data?.groups.find((candidate) => candidate.id === groupId);
	const isCodeManaged = managementStatus.data?.mode === 'code';
	const pendingEmails =
		group === 'new'
			? []
			: (managementStatus.data?.pendingAssignments ?? [])
					.filter((assignment) => assignment.groupId === group?.id)
					.map((assignment) => assignment.email);

	useEffect(() => {
		if (
			(isCodeManaged && groupId === 'new') ||
			(groupId !== 'new' && overview.data && (!group || (group !== 'new' && group.isLocked)))
		) {
			void navigate({
				to: '/settings/project/user-groups',
				search: { tab: 'groups' },
				replace: true,
			});
		}
	}, [group, groupId, isCodeManaged, navigate, overview.data]);

	if (overview.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading group...</div>;
	}
	if (overview.isError) {
		return <div className='text-sm text-destructive'>Failed to load User Groups.</div>;
	}
	if (!group || (group !== 'new' && group.isLocked)) {
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
			{isCodeManaged && (
				<div className='rounded-md border bg-muted/40 p-3 text-sm'>
					<p>
						Managed in <code>user_groups.yaml</code>. Deploy an updated file to change this group.
					</p>
					{pendingEmails.length > 0 && (
						<p className='mt-1 text-amber-700 dark:text-amber-400'>
							Pending desired members: {pendingEmails.join(', ')}
						</p>
					)}
				</div>
			)}
			<UserGroupEditor
				group={group}
				readOnly={isCodeManaged}
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
	return (
		value === 'features' ||
		value === 'context' ||
		value === 'mcp' ||
		value === 'skills' ||
		value === 'security' ||
		value === 'budget' ||
		value === 'advanced' ||
		value === 'sso'
	);
}
