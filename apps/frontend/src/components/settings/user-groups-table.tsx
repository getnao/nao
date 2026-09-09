import { USER_ROLE_LABELS } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { MemberStatus, UserRole } from '@nao/shared/types';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { getUserGroupAccessSummary } from '@/components/settings/user-group-access-summary';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { invalidateUserGroupQueries } from '@/components/settings/user-group-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsCard } from '@/components/ui/settings-card';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

type UserGroup = UserGroupEditorGroup;
type ProjectAccessSource = 'project' | 'organization' | 'both';
export type UserGroupsPageTab = 'groups' | 'users';

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
];

interface UserGroupsTableProps {
	tab: UserGroupsPageTab;
	onTabChange: (tab: UserGroupsPageTab) => void;
}

export function UserGroupsTable({ tab, onTabChange }: UserGroupsTableProps) {
	const licenseFeatures = useLicenseFeatures();

	if (licenseFeatures.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading User Groups...</div>;
	}
	if (licenseFeatures.isError) {
		return <div className='text-sm text-destructive'>Failed to load license features.</div>;
	}
	if (!licenseFeatures.data?.['user-groups']) {
		return (
			<SettingsCard
				description='Control which product features project users can access.'
				action={<UpgradeToEnterprise />}
			>
				<p className='text-sm text-muted-foreground'>User Groups is available with nao Enterprise.</p>
			</SettingsCard>
		);
	}

	return <LicensedUserGroupsTable tab={tab} onTabChange={onTabChange} />;
}

export function resolveUserGroupsPageTab(value: unknown): UserGroupsPageTab {
	return value === 'groups' || value === 'users' ? value : 'users';
}

function LicensedUserGroupsTable({ tab, onTabChange }: UserGroupsTableProps) {
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const contextCatalog = useQuery(trpc.userGroup.contextCatalog.queryOptions());
	const docsContextCatalog = useQuery(trpc.userGroup.docsContextCatalog.queryOptions());
	const navigate = useNavigate();
	const membershipKeys = useMemo(
		() => new Set(overview.data?.memberships.map(({ groupId, userId }) => `${groupId}:${userId}`)),
		[overview.data?.memberships],
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
	const contextObjects = contextCatalog.data?.objects ?? [];
	const docsEntries = docsContextCatalog.data?.entries ?? [];

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
							groups={groups}
							membershipKeys={membershipKeys}
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
			</TabPanel>
		</>
	);
}
function GroupsTable({
	groups,
	memberships,
	contextObjects,
	docsEntries,
	onOpenGroup,
	onCreateGroup,
}: {
	groups: UserGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	contextObjects: DatabaseContextObject[];
	docsEntries: DocsContextCatalogEntry[];
	onOpenGroup: (groupId: string) => void;
	onCreateGroup: () => void;
}) {
	return (
		<SettingsCard
			description='Configure the features, database tables, and docs each group can access.'
			action={
				<Button onClick={onCreateGroup}>
					<Plus />
					Create group
				</Button>
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
					{groups.map((group) => (
						<TableRow
							key={group.id}
							className='cursor-pointer hover:bg-primary/10'
							onClick={() => onOpenGroup(group.id)}
						>
							<TableCell>
								<div className='flex items-center gap-2'>
									<Link
										to='/settings/project/user-groups/$groupId'
										params={{ groupId: group.id }}
										search={{ tab: 'features' }}
										className='font-medium hover:underline'
										onClick={(event) => event.stopPropagation()}
									>
										{group.name}
									</Link>
									{group.isDefault && (
										<Badge variant='secondary' className='h-5 px-1.5 py-0 text-[10px] font-normal'>
											Default
										</Badge>
									)}
								</div>
							</TableCell>
							<TableCell>
								{memberships.filter((membership) => membership.groupId === group.id).length}
							</TableCell>
							<TableCell className='whitespace-nowrap text-muted-foreground'>
								{getUserGroupAccessSummary(group, contextObjects, docsEntries)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</SettingsCard>
	);
}

function UserAccessTable({
	projectUsers,
	organizationUsers,
	groups,
	membershipKeys,
	onOpenUser,
}: {
	projectUsers: UserWithProjectAccess[];
	organizationUsers: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
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
							onOpenUser={onOpenUser}
						/>
					)}
					{organizationUsers.length > 0 && (
						<UserAccessSection
							label='Organisation Members'
							users={organizationUsers}
							groups={groups}
							membershipKeys={membershipKeys}
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
	onOpenUser,
}: {
	label: string;
	users: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
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
						<UserGroupsCell user={user} groups={groups} membershipKeys={membershipKeys} />
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
}: {
	user: UserWithProjectAccess;
	groups: UserGroup[];
	membershipKeys: Set<string>;
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
				{groups.map((group) => (
					<DropdownMenuCheckboxItem
						key={group.id}
						checked={group.isDefault || membershipKeys.has(`${group.id}:${user.id}`)}
						disabled={group.isDefault || setMembership.isPending}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							setMembership.mutate({
								groupId: group.id,
								userId: user.id,
								isMember: checked === true,
							})
						}
					>
						{group.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
