import { FREE_CUSTOM_USER_GROUP_LIMIT } from '@nao/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Lock, Plus } from 'lucide-react';
import { useMemo } from 'react';

import type { UserGroupCatalogState } from '@/components/settings/user-group-access-summary';
import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { FileTreeCatalogEntry } from '@/components/settings/user-group-file-tree-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { getUserGroupAccessSummary } from '@/components/settings/user-group-access-summary';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { ProjectRowSecurity } from '@/components/settings/project-row-security';
import { ProjectUsersTable } from '@/components/settings/project-users-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SettingsCard } from '@/components/ui/settings-card';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

interface LockedUserGroup {
	id: string;
	name: string;
	isDefault: false;
	isLocked: true;
}

type UserGroup = UserGroupEditorGroup | LockedUserGroup;
type UserGroupsEntitlement = 'loading' | 'error' | 'free' | 'unlimited';
export type UserGroupsPageTab = 'groups' | 'security' | 'users';

const USER_GROUPS_PAGE_TABS: Array<{ id: UserGroupsPageTab; label: string }> = [
	{ id: 'users', label: 'Users' },
	{ id: 'groups', label: 'Manage Groups' },
	{ id: 'security', label: 'Security' },
];

interface UserGroupsTableProps {
	tab: UserGroupsPageTab;
	onTabChange: (tab: UserGroupsPageTab) => void;
}

export function UserGroupsTable({ tab, onTabChange }: UserGroupsTableProps) {
	const licenseFeatures = useLicenseFeatures();
	const entitlement: UserGroupsEntitlement = licenseFeatures.isLoading
		? 'loading'
		: licenseFeatures.isError || !licenseFeatures.data
			? 'error'
			: licenseFeatures.data['user-groups']
				? 'unlimited'
				: 'free';

	return <UserGroupsContent tab={tab} onTabChange={onTabChange} entitlement={entitlement} />;
}

export function resolveUserGroupsPageTab(value: unknown): UserGroupsPageTab {
	return value === 'groups' || value === 'security' || value === 'users' ? value : 'users';
}

function UserGroupsContent({
	tab,
	onTabChange,
	entitlement,
}: UserGroupsTableProps & { entitlement: UserGroupsEntitlement }) {
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const contextCatalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const docsContextCatalog = useQuery(trpc.userGroup.docsContextCatalog.queryOptions());
	const filesContextCatalog = useQuery(trpc.userGroup.filesContextCatalog.queryOptions());
	const navigate = useNavigate();
	const membershipKeys = useMemo(
		() => new Set(overview.data?.memberships.map(({ groupId, userId }) => `${groupId}:${userId}`)),
		[overview.data?.memberships],
	);
	const ssoMembershipKeys = useMemo(
		() => new Set(overview.data?.ssoMemberships.map(({ groupId, userId }) => `${groupId}:${userId}`)),
		[overview.data?.ssoMemberships],
	);

	const tabs = (
		<TabBar
			tabs={USER_GROUPS_PAGE_TABS}
			activeTab={tab}
			onTabChange={onTabChange}
			idBase='user-groups-page'
			className='border-b'
		/>
	);

	if (overview.isLoading || overview.isError || !overview.data) {
		return (
			<>
				{tabs}
				<TabPanel idBase='user-groups-page' tabId={tab} className='pt-5'>
					{overview.isLoading ? (
						<div className='text-sm text-muted-foreground'>Loading groups...</div>
					) : overview.isError ? (
						<div className='text-sm text-destructive'>Failed to load User Groups.</div>
					) : null}
				</TabPanel>
			</>
		);
	}

	const projectUsers = overview.data.users.filter((user) => user.source !== 'organization');
	const organizationUsers = overview.data.users.filter((user) => user.source === 'organization');
	const groups = overview.data.groups;
	const activeGroups = groups.filter((group) => !group.isLocked);
	const contextObjects = contextCatalog.data?.objects ?? [];
	const docsEntries = docsContextCatalog.data?.entries ?? [];
	const filesEntries = filesContextCatalog.data?.entries ?? [];
	const databaseCatalogState = getCatalogState(contextCatalog);
	const docsCatalogState = getCatalogState(docsContextCatalog);
	const filesCatalogState = getCatalogState(filesContextCatalog);

	return (
		<>
			{tabs}
			<TabPanel idBase='user-groups-page' tabId={tab} className='pt-5'>
				{tab === 'groups' && (
					<GroupsTable
						groups={groups}
						memberships={overview.data.memberships}
						contextObjects={contextObjects}
						docsEntries={docsEntries}
						filesEntries={filesEntries}
						databaseCatalogState={databaseCatalogState}
						docsCatalogState={docsCatalogState}
						filesCatalogState={filesCatalogState}
						onRetryDatabaseCatalog={() => void contextCatalog.refetch()}
						onRetryDocsCatalog={() => void docsContextCatalog.refetch()}
						onRetryFilesCatalog={() => void filesContextCatalog.refetch()}
						entitlement={entitlement}
						onOpenGroup={(groupId) => {
							void navigate({
								to: '/settings/project/user-groups/$groupId',
								params: { groupId },
								search: { tab: 'features' },
							});
						}}
						onCreateGroup={() => {
							void navigate({
								to: '/settings/project/user-groups/$groupId',
								params: { groupId: 'new' },
								search: { tab: 'features' },
							});
						}}
					/>
				)}
				{tab === 'users' && (
					<ProjectUsersTable
						canManage
						projectUsers={projectUsers}
						organizationUsers={organizationUsers}
						groups={activeGroups}
						membershipKeys={membershipKeys}
						ssoMembershipKeys={ssoMembershipKeys}
						onOpenUser={(userId) => {
							void navigate({
								to: '/settings/project/user-groups/users/$userId',
								params: { userId },
								search: { tab: 'features' },
							});
						}}
					/>
				)}
				{tab === 'security' && (
					<ProjectRowSecurity
						objects={contextObjects}
						catalogState={databaseCatalogState}
						onRetryCatalog={() => void contextCatalog.refetch()}
					/>
				)}
			</TabPanel>
		</>
	);
}
function GroupsTable({
	groups,
	memberships,
	contextObjects,
	docsEntries,
	filesEntries,
	databaseCatalogState,
	docsCatalogState,
	filesCatalogState,
	onRetryDatabaseCatalog,
	onRetryDocsCatalog,
	onRetryFilesCatalog,
	entitlement,
	onOpenGroup,
	onCreateGroup,
}: {
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	contextObjects: DatabaseContextObject[];
	docsEntries: FileTreeCatalogEntry[];
	filesEntries: FileTreeCatalogEntry[];
	databaseCatalogState: UserGroupCatalogState;
	docsCatalogState: UserGroupCatalogState;
	filesCatalogState: UserGroupCatalogState;
	onRetryDatabaseCatalog: () => void;
	onRetryDocsCatalog: () => void;
	onRetryFilesCatalog: () => void;
	entitlement: UserGroupsEntitlement;
	onOpenGroup: (groupId: string) => void;
	onCreateGroup: () => void;
}) {
	const customGroupCount = groups.filter((group) => !group.isDefault).length;
	const canCreateGroup = entitlement === 'unlimited' || customGroupCount < FREE_CUSTOM_USER_GROUP_LIMIT;
	const sortedGroups = [...groups].sort(compareUserGroupsForDisplay);

	return (
		<SettingsCard
			title='Group access'
			description='Configure the features, database tables, docs, and project files each group can access.'
			action={
				entitlement === 'loading' ? (
					<Button disabled>Loading group access...</Button>
				) : entitlement === 'error' ? (
					<Button disabled>Create group unavailable</Button>
				) : canCreateGroup ? (
					<Button onClick={onCreateGroup}>
						<Plus />
						Create group
					</Button>
				) : (
					<CreateGroupUpgradeNudge />
				)
			}
			flush
		>
			<Table>
				<TableHeader>
					<TableRow className='[&_th]:h-12'>
						<TableHead>Group</TableHead>
						<TableHead>Members</TableHead>
						<TableHead>Access</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{sortedGroups.map((group) => (
						<TableRow
							key={group.id}
							className={group.isLocked ? 'bg-muted/20' : 'cursor-pointer hover:bg-primary/10'}
							onClick={group.isLocked ? undefined : () => onOpenGroup(group.id)}
						>
							<TableCell>
								<div className='flex items-center gap-2'>
									{group.isLocked ? (
										<span className='font-medium text-muted-foreground'>{group.name}</span>
									) : (
										<Link
											to='/settings/project/user-groups/$groupId'
											params={{ groupId: group.id }}
											search={{ tab: 'features' }}
											className='font-medium hover:underline'
											onClick={(event) => event.stopPropagation()}
										>
											{group.name}
										</Link>
									)}
									{group.isDefault && (
										<Badge variant='secondary' className='h-5 px-1.5 py-0 text-[10px] font-normal'>
											Default
										</Badge>
									)}
									{group.isLocked && (
										<LockedGroupUpgradeNudge groupId={group.id} groupName={group.name} />
									)}
								</div>
							</TableCell>
							<TableCell>
								{group.isLocked
									? 'Inactive'
									: memberships.filter((membership) => membership.groupId === group.id).length}
							</TableCell>
							<TableCell className='whitespace-nowrap text-muted-foreground'>
								{group.isLocked ? (
									'Locked'
								) : (
									<div className='flex items-center gap-1'>
										<span>
											{getUserGroupAccessSummary(
												group,
												contextObjects,
												docsEntries,
												filesEntries,
												{
													database: databaseCatalogState,
													docs: docsCatalogState,
													files: filesCatalogState,
												},
											)}
										</span>
										{databaseCatalogState === 'error' && (
											<Button
												type='button'
												size='sm'
												variant='ghost'
												className='h-6 px-2 text-xs'
												aria-label={`Retry tables for ${group.name}`}
												onClick={(event) => {
													event.stopPropagation();
													onRetryDatabaseCatalog();
												}}
											>
												Retry tables
											</Button>
										)}
										{docsCatalogState === 'error' && (
											<Button
												type='button'
												size='sm'
												variant='ghost'
												className='h-6 px-2 text-xs'
												aria-label={`Retry docs for ${group.name}`}
												onClick={(event) => {
													event.stopPropagation();
													onRetryDocsCatalog();
												}}
											>
												Retry docs
											</Button>
										)}
										{filesCatalogState === 'error' && (
											<Button
												type='button'
												size='sm'
												variant='ghost'
												className='h-6 px-2 text-xs'
												aria-label={`Retry files for ${group.name}`}
												onClick={(event) => {
													event.stopPropagation();
													onRetryFilesCatalog();
												}}
											>
												Retry files
											</Button>
										)}
									</div>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</SettingsCard>
	);
}

function compareUserGroupsForDisplay(left: UserGroup, right: UserGroup) {
	if (left.isLocked !== right.isLocked) {
		return left.isLocked ? 1 : -1;
	}

	return left.name.localeCompare(right.name);
}

function LockedGroupUpgradeNudge({ groupId, groupName }: { groupId: string; groupName: string }) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type='button'
					aria-label={`${groupName} requires Enterprise`}
					className='inline-flex h-4 cursor-pointer items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary'
					onClick={(event) => event.stopPropagation()}
				>
					<Lock className='size-2.5 shrink-0' />
					Enterprise
				</button>
			</PopoverTrigger>
			<PopoverContent align='start' aria-labelledby={`locked-group-${groupId}`}>
				<div className='flex flex-col gap-3'>
					<div>
						<h3 id={`locked-group-${groupId}`} className='text-sm font-medium'>
							Inactive user group
						</h3>
						<p className='mt-1 text-xs text-muted-foreground'>
							The free plan allows only 3 custom groups. Upgrade to Enterprise to have more.
						</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			</PopoverContent>
		</Popover>
	);
}

function CreateGroupUpgradeNudge() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant='secondary' className='w-72' aria-label='Create group'>
					<Plus />
					Create group
					<span
						aria-hidden='true'
						className='inline-flex h-4 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary'
					>
						<Lock className='size-2.5 shrink-0' />
						Enterprise
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' aria-labelledby='create-group-upgrade-title'>
				<div className='flex flex-col gap-3'>
					<div>
						<h3 id='create-group-upgrade-title' className='text-sm font-medium'>
							Unlimited user groups
						</h3>
						<p className='mt-1 text-xs text-muted-foreground'>
							The free plan allows only 3 custom groups. Upgrade to Enterprise to create more.
						</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			</PopoverContent>
		</Popover>
	);
}

function getCatalogState(query: { isLoading: boolean; isError: boolean }): UserGroupCatalogState {
	if (query.isLoading) {
		return 'loading';
	}
	if (query.isError) {
		return 'error';
	}
	return 'ready';
}
