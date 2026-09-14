import { FREE_CUSTOM_USER_GROUP_LIMIT } from '@nao/shared';
import { USER_ROLE_LABELS } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Lock, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { MemberStatus, UserRole } from '@nao/shared/types';

import type { UserGroupCatalogState } from '@/components/settings/user-group-access-summary';
import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { getUserGroupAccessSummary } from '@/components/settings/user-group-access-summary';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { ProjectRowSecurity } from '@/components/settings/project-row-security';
import { invalidateUserGroupQueries } from '@/components/settings/user-group-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
type ProjectAccessSource = 'project' | 'organization' | 'both';
export type UserGroupsPageTab = 'groups' | 'security' | 'users';

interface UserWithProjectAccess {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
	source: ProjectAccessSource;
}

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

	return (
		<UserGroupsContent
			tab={tab}
			onTabChange={onTabChange}
			hasUnlimitedGroups={licenseFeatures.data?.['user-groups'] === true}
		/>
	);
}

export function resolveUserGroupsPageTab(value: unknown): UserGroupsPageTab {
	return value === 'groups' || value === 'security' || value === 'users' ? value : 'users';
}

function UserGroupsContent({
	tab,
	onTabChange,
	hasUnlimitedGroups,
}: UserGroupsTableProps & { hasUnlimitedGroups: boolean }) {
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const contextCatalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const docsContextCatalog = useQuery(trpc.userGroup.docsContextCatalog.queryOptions());
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
	const databaseCatalogState = getCatalogState(contextCatalog);
	const docsCatalogState = getCatalogState(docsContextCatalog);

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
						databaseCatalogState={databaseCatalogState}
						docsCatalogState={docsCatalogState}
						onRetryDatabaseCatalog={() => void contextCatalog.refetch()}
						onRetryDocsCatalog={() => void docsContextCatalog.refetch()}
						hasUnlimitedGroups={hasUnlimitedGroups}
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
					<SettingsCard description='Assign project users to groups.' flush>
						<UserAccessTable
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
					</SettingsCard>
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
	databaseCatalogState,
	docsCatalogState,
	onRetryDatabaseCatalog,
	onRetryDocsCatalog,
	hasUnlimitedGroups,
	onOpenGroup,
	onCreateGroup,
}: {
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	contextObjects: DatabaseContextObject[];
	docsEntries: DocsContextCatalogEntry[];
	databaseCatalogState: UserGroupCatalogState;
	docsCatalogState: UserGroupCatalogState;
	onRetryDatabaseCatalog: () => void;
	onRetryDocsCatalog: () => void;
	hasUnlimitedGroups: boolean;
	onOpenGroup: (groupId: string) => void;
	onCreateGroup: () => void;
}) {
	const customGroupCount = groups.filter((group) => !group.isDefault).length;
	const canCreateGroup = hasUnlimitedGroups || customGroupCount < FREE_CUSTOM_USER_GROUP_LIMIT;
	const sortedGroups = [...groups].sort(compareUserGroupsForDisplay);

	return (
		<SettingsCard
			title='Group access'
			description='Configure the features, database tables, and docs each group can access.'
			action={
				canCreateGroup ? (
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
											{getUserGroupAccessSummary(group, contextObjects, docsEntries, {
												database: databaseCatalogState,
												docs: docsCatalogState,
											})}
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
					className='inline-flex h-4 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary'
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

function UserAccessTable({
	projectUsers,
	organizationUsers,
	groups,
	membershipKeys,
	ssoMembershipKeys,
	onOpenUser,
}: {
	projectUsers: UserWithProjectAccess[];
	organizationUsers: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
	ssoMembershipKeys: Set<string>;
	onOpenUser: (userId: string) => void;
}) {
	const hasUsers = projectUsers.length > 0 || organizationUsers.length > 0;

	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-3xl table-fixed'>
				<TableHeader>
					<TableRow className='[&_th]:h-12'>
						<TableHead className='w-[38%]'>User</TableHead>
						<TableHead className='w-1/5'>Role</TableHead>
						<TableHead className='w-[42%]'>Groups</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{!hasUsers && (
						<TableRow>
							<TableCell colSpan={3} className='h-24 text-center'>
								No users have access to this project.
							</TableCell>
						</TableRow>
					)}
					{projectUsers.length > 0 && (
						<UserAccessSection
							label='Project Team'
							users={projectUsers}
							groups={groups}
							membershipKeys={membershipKeys}
							ssoMembershipKeys={ssoMembershipKeys}
							onOpenUser={onOpenUser}
						/>
					)}
					{organizationUsers.length > 0 && (
						<UserAccessSection
							label='Organisation Members'
							users={organizationUsers}
							groups={groups}
							membershipKeys={membershipKeys}
							ssoMembershipKeys={ssoMembershipKeys}
							onOpenUser={onOpenUser}
						/>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function UserAccessSection({
	label,
	users,
	groups,
	membershipKeys,
	ssoMembershipKeys,
	onOpenUser,
}: {
	label: string;
	users: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
	ssoMembershipKeys: Set<string>;
	onOpenUser: (userId: string) => void;
}) {
	return (
		<>
			<TableRow className='border-y bg-muted/40 hover:bg-muted/40'>
				<TableCell colSpan={3} className='py-2.5 text-xs font-semibold text-muted-foreground'>
					{label}
				</TableCell>
			</TableRow>
			{users.map((user) => (
				<TableRow
					key={user.id}
					className='cursor-pointer hover:bg-primary/10'
					onClick={() => onOpenUser(user.id)}
				>
					<TableCell className='min-w-0 overflow-hidden'>
						<div className='flex min-w-0 flex-col'>
							<Link
								to='/settings/project/user-groups/users/$userId'
								params={{ userId: user.id }}
								search={{ tab: 'features' }}
								className='truncate font-medium hover:underline'
								title={user.name}
								onClick={(event) => event.stopPropagation()}
							>
								{user.name}
							</Link>
							<span className='truncate text-xs text-muted-foreground' title={user.email}>
								{user.email}
								{user.status ? ` · ${user.status}` : ''}
							</span>
						</div>
					</TableCell>
					<TableCell className='min-w-0 overflow-hidden'>
						<Badge variant={user.role}>{USER_ROLE_LABELS[user.role]}</Badge>
					</TableCell>
					<TableCell className='min-w-0 overflow-hidden'>
						<UserGroupsCell
							user={user}
							groups={groups}
							membershipKeys={membershipKeys}
							ssoMembershipKeys={ssoMembershipKeys}
						/>
					</TableCell>
				</TableRow>
			))}
		</>
	);
}

function UserGroupsCell({
	user,
	groups,
	membershipKeys,
	ssoMembershipKeys,
}: {
	user: UserWithProjectAccess;
	groups: UserGroup[];
	membershipKeys: Set<string>;
	ssoMembershipKeys: Set<string>;
}) {
	const queryClient = useQueryClient();
	const setMembership = useMutation(
		trpc.userGroup.setMembership.mutationOptions({
			onSuccess: () => invalidateUserGroupQueries(queryClient),
		}),
	);
	const selectedGroupNames = useMemo(
		() =>
			groups
				.filter((group) => group.isDefault || membershipKeys.has(`${group.id}:${user.id}`))
				.map((group) => group.name),
		[groups, membershipKeys, user.id],
	);
	const selectedGroupLabel = selectedGroupNames.length > 0 ? selectedGroupNames.join(', ') : 'No groups';

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className='h-8 w-full min-w-0 justify-between overflow-hidden bg-background font-normal'
					aria-label={`Manage groups for ${user.name}. Current groups: ${selectedGroupLabel}`}
					title={selectedGroupLabel}
					onClick={(event) => event.stopPropagation()}
				>
					<ResponsiveGroupChips names={selectedGroupNames} />
					<ChevronDown className='shrink-0' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align='start'
				className='max-h-64 min-w-56'
				onClick={(event) => event.stopPropagation()}
			>
				{groups.map((group) => {
					const membershipKey = `${group.id}:${user.id}`;
					const isManagedBySso = ssoMembershipKeys.has(membershipKey);
					return (
						<DropdownMenuCheckboxItem
							key={group.id}
							checked={group.isDefault || membershipKeys.has(membershipKey)}
							disabled={group.isDefault || isManagedBySso || setMembership.isPending}
							aria-label={isManagedBySso ? `${group.name}, managed by SSO` : group.name}
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={(checked) =>
								setMembership.mutate({
									groupId: group.id,
									userId: user.id,
									isMember: checked === true,
								})
							}
						>
							<span className='min-w-0 flex-1 truncate'>{group.name}</span>
							{isManagedBySso && (
								<Badge variant='secondary' className='ml-2 h-5 px-1.5 py-0 text-[10px] font-normal'>
									Managed by SSO
								</Badge>
							)}
						</DropdownMenuCheckboxItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
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
