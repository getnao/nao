import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';

import type { UserGroupEditorTab } from '@/components/settings/user-group-editor';
import { UserGroupUserDetail } from '@/components/settings/user-group-user-detail';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/user-groups/users/$userId')({
	validateSearch: (search: Record<string, unknown>): { tab: UserGroupEditorTab } => ({
		tab: isUserGroupEditorTab(search.tab) ? search.tab : 'features',
	}),
	component: UserGroupUserDetailPage,
});

function UserGroupUserDetailPage() {
	const { userId } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = Route.useNavigate();
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const effectiveAccess = useQuery(trpc.userGroup.effectiveAccessForUser.queryOptions({ userId }));
	const contextCatalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const docsContextCatalog = useQuery(trpc.userGroup.docsContextCatalog.queryOptions());
	const overviewData = overview.data;
	const user = overviewData?.users.find((candidate) => candidate.id === userId);
	const targetUserMissing = effectiveAccess.error?.data?.code === 'NOT_FOUND';

	useEffect(() => {
		if ((overviewData && !user) || targetUserMissing) {
			void navigate({
				to: '/settings/project/user-groups',
				search: { tab: 'users' },
				replace: true,
			});
		}
	}, [navigate, overviewData, targetUserMissing, user]);

	if (overview.isLoading || effectiveAccess.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading user access...</div>;
	}
	if (overview.isError || effectiveAccess.isError) {
		return <div className='text-sm text-destructive'>Failed to load user access.</div>;
	}
	if (!overviewData || !user || !effectiveAccess.data) {
		return null;
	}

	return (
		<div className='flex flex-col gap-6'>
			<Link
				to='/settings/project/user-groups'
				search={{ tab: 'users' }}
				className='inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
			>
				<ChevronLeft className='size-3.5' />
				User Groups
			</Link>
			<UserGroupUserDetail
				user={user}
				groups={overviewData.groups}
				memberships={overviewData.memberships}
				effectiveAccess={effectiveAccess.data}
				contextObjects={contextCatalog.data?.objects ?? []}
				docsEntries={docsContextCatalog.data?.entries ?? []}
				databaseSyncState={contextCatalog.data?.syncState}
				docsSyncState={docsContextCatalog.data?.syncState}
				databaseCatalogState={contextCatalog.isLoading ? 'loading' : contextCatalog.isError ? 'error' : 'ready'}
				docsCatalogState={
					docsContextCatalog.isLoading ? 'loading' : docsContextCatalog.isError ? 'error' : 'ready'
				}
				onRetryDatabaseCatalog={() => void contextCatalog.refetch()}
				onRetryDocsCatalog={() => void docsContextCatalog.refetch()}
				activeTab={tab}
				onTabChange={(nextTab) => {
					void navigate({
						search: { tab: nextTab },
						replace: true,
					});
				}}
			/>
		</div>
	);
}

function isUserGroupEditorTab(value: unknown): value is UserGroupEditorTab {
	return value === 'features' || value === 'context' || value === 'security';
}
