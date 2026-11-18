import { USER_ROLE_LABELS, USER_ROLES } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EllipsisVertical, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemberStatus, UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import type { ProjectUserFilters } from '@/lib/project-user-filters';
import type { UserSectionsPagination } from '@/hooks/use-paginated-user-sections';
import type { UserGroupToken } from '@/components/settings/user-group-token-field';
import {
	AddMemberDialog,
	EditMemberDialog,
	NewCredentialsDialog,
	RemoveMemberDialog,
} from '@/components/settings/team';
import { ProjectUsersToolbar } from '@/components/settings/project-users-toolbar';
import { invalidateUserGroupQueries } from '@/components/settings/user-group-editor';
import { UserGroupTokenField } from '@/components/settings/user-group-token-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePaginatedUserSections } from '@/hooks/use-paginated-user-sections';
import { useSession } from '@/lib/auth-client';
import { ALL_GROUPS_FILTER, filterProjectUsers, hasActiveProjectUserFilters } from '@/lib/project-user-filters';
import { countUsers } from '@/lib/user-sections-pagination';
import { trpc, trpcClient } from '@/main';

const BULK_MEMBERSHIP_BATCH_SIZE = 1_000;
const LISTED_SKIPPED_USERS_LIMIT = 3;

export type ProjectAccessSource = 'project' | 'organization' | 'both';

export interface ProjectUser {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
	source: ProjectAccessSource;
}

export interface AssignableUserGroup {
	id: string;
	name: string;
	isDefault: boolean;
}

interface ProjectMemberActions {
	onEdit: (user: ProjectUser) => void;
	onRemove: (user: ProjectUser) => void;
	onResetPassword?: (user: ProjectUser) => void;
}

interface GroupAccess {
	groups: AssignableUserGroup[];
	membershipKeys: Set<string>;
	ssoMembershipKeys: Set<string>;
	canManageGroups: boolean;
}

interface BulkMembershipChange {
	groupId: string;
	userIds: string[];
	isMember: boolean;
}

interface UserSelection {
	selectedUserIds: Set<string>;
	selectableCount: number;
	onToggleUser: (userId: string, isSelected: boolean) => void;
	onToggleAll: (isSelected: boolean) => void;
}

interface UserAccessManagement {
	groupAccess: GroupAccess;
	memberActions: ProjectMemberActions;
	selection: UserSelection;
	onOpenUser: (userId: string) => void;
}

interface ProjectUsersProps {
	projectUsers: ProjectUser[];
	organizationUsers: ProjectUser[];
}

type ManagedProjectUsersTableProps = ProjectUsersProps &
	GroupAccess & {
		onOpenUser: (userId: string) => void;
	};

type ProjectUsersTableProps =
	| (ProjectUsersProps & { canManage: false })
	| (ManagedProjectUsersTableProps & { canManage: true });

export function ProjectUsersTable(props: ProjectUsersTableProps) {
	if (!props.canManage) {
		return (
			<ReadOnlyProjectUsersTable projectUsers={props.projectUsers} organizationUsers={props.organizationUsers} />
		);
	}
	return <ManagedProjectUsersTable {...props} />;
}

export function ReadOnlyProjectUsers() {
	const users = useQuery(trpc.project.listUsersWithAccess.queryOptions());

	if (users.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading users...</div>;
	}
	if (users.isError || !users.data) {
		return <div className='text-sm text-destructive'>Failed to load users.</div>;
	}

	return (
		<ProjectUsersTable
			canManage={false}
			projectUsers={users.data.filter((user) => user.source !== 'organization')}
			organizationUsers={users.data.filter((user) => user.source === 'organization')}
		/>
	);
}

function ReadOnlyProjectUsersTable({ projectUsers, organizationUsers }: ProjectUsersProps) {
	const { data: session } = useSession();
	const users = { projectUsers, organizationUsers };
	const { page, pagination } = usePaginatedUserSections(users, countUsers(users));

	return (
		<SettingsCard title='Members' description='People who have access to this project.' flush>
			<UserAccessTable
				projectUsers={page.projectUsers}
				organizationUsers={page.organizationUsers}
				currentUserId={session?.user?.id}
				pagination={pagination}
			/>
		</SettingsCard>
	);
}

function ManagedProjectUsersTable({
	projectUsers,
	organizationUsers,
	groups,
	membershipKeys,
	ssoMembershipKeys,
	canManageGroups,
	onOpenUser,
}: ManagedProjectUsersTableProps) {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const isCloud = useIsCloud();

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editMember, setEditMember] = useState<ProjectUser | null>(null);
	const [removeMember, setRemoveMember] = useState<ProjectUser | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<ProjectUser | null>(null);
	const [resetPasswordError, setResetPasswordError] = useState('');
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

	const [filters, setFilters] = useState<ProjectUserFilters>({ search: '', groupFilter: ALL_GROUPS_FILTER });
	const customGroups = useMemo(() => groups.filter((group) => !group.isDefault), [groups]);
	const visibleUsers = useMemo(() => {
		const customGroupIds = customGroups.map((group) => group.id);
		return {
			projectUsers: filterProjectUsers(projectUsers, filters, customGroupIds, membershipKeys),
			organizationUsers: filterProjectUsers(organizationUsers, filters, customGroupIds, membershipKeys),
		};
	}, [projectUsers, organizationUsers, filters, customGroups, membershipKeys]);
	const selectableUsers = [...visibleUsers.projectUsers, ...visibleUsers.organizationUsers];
	const selection = useVisibleUserSelection(selectableUsers);
	const paginatedUsers = usePaginatedUserSections(visibleUsers, projectUsers.length + organizationUsers.length);
	const [bulkNotice, setBulkNotice] = useState('');

	const addUser = useMutation(trpc.user.addUserToProject.mutationOptions());
	const modifyUser = useMutation(trpc.user.modify.mutationOptions());
	const removeUser = useMutation(trpc.project.removeProjectMember.mutationOptions());
	const resetPassword = useMutation(trpc.account.resetPassword.mutationOptions());
	const setMemberships = useMutation({
		mutationKey: trpc.userGroup.setMemberships.mutationKey(),
		mutationFn: setMembershipsInBatches,
	});

	const invalidateMembers = () => {
		return Promise.all([
			invalidateUserGroupQueries(queryClient),
			queryClient.invalidateQueries({ queryKey: trpc.project.listAllUsersWithRoles.queryKey() }),
		]);
	};

	const handleAdd = async (data: { email: string; name?: string; groupIds?: string[] }) => {
		try {
			const result = await addUser.mutateAsync({
				email: data.email,
				name: data.name,
				groupIds: data.groupIds ?? [],
			});
			await invalidateMembers();
			if (result.password) {
				setCredentials({ email: data.email, password: result.password });
			}
			return {};
		} catch (err: any) {
			if (err.message === 'USER_DOES_NOT_EXIST') {
				return { needsName: true };
			}
			throw err;
		}
	};

	const handleEdit = async (data: { userId: string; name?: string; newRole?: UserRole }) => {
		await modifyUser.mutateAsync(data);
		await invalidateMembers();
	};

	const handleRemove = async () => {
		if (!removeMember) {
			return;
		}
		await removeUser.mutateAsync({ userId: removeMember.id });
		await invalidateMembers();
	};

	const handleResetPassword = async () => {
		if (!resetPasswordMember) {
			return;
		}
		setResetPasswordError('');
		try {
			const result = await resetPassword.mutateAsync({ userId: resetPasswordMember.id });
			closeResetPasswordDialog();
			setCredentials({ email: resetPasswordMember.email, password: result.password });
		} catch (err) {
			setResetPasswordError(err instanceof Error ? err.message : String(err));
		}
	};

	const closeResetPasswordDialog = () => {
		setResetPasswordMember(null);
		setResetPasswordError('');
	};

	const handleBulkMembershipChange = (groupId: string, isMember: boolean) => {
		const selectedUsers = selectableUsers.filter((user) => selection.selectedUserIds.has(user.id));
		const isManagedBySso = (user: ProjectUser) => ssoMembershipKeys.has(`${groupId}:${user.id}`);
		const ssoManagedUsers = selectedUsers.filter(isManagedBySso);
		const userIds = selectedUsers.filter((user) => !isManagedBySso(user)).map((user) => user.id);
		const groupName = groups.find((group) => group.id === groupId)?.name ?? 'this group';
		setBulkNotice(describeSsoManagedUsers(ssoManagedUsers, groupName));
		if (userIds.length === 0) {
			return;
		}
		setMemberships.mutate(
			{ groupId, userIds, isMember },
			{
				onSuccess: () => selection.clear(),
				onSettled: () => invalidateUserGroupQueries(queryClient),
			},
		);
	};

	const management: UserAccessManagement = {
		groupAccess: { groups, membershipKeys, ssoMembershipKeys, canManageGroups },
		memberActions: {
			onEdit: setEditMember,
			onRemove: setRemoveMember,
			onResetPassword: isCloud ? undefined : setResetPasswordMember,
		},
		selection,
		onOpenUser,
	};

	return (
		<>
			<SettingsCard
				title='Members'
				description={
					canManageGroups
						? 'Add members to the project and assign them to groups.'
						: 'Add members to the project. Group memberships are managed by user_groups.yaml.'
				}
				flush
				className='gap-0'
				action={
					<Button onClick={() => setIsAddOpen(true)}>
						<Plus />
						Add member
					</Button>
				}
			>
				<ProjectUsersToolbar
					filters={filters}
					onFiltersChange={(nextFilters) => {
						setFilters(nextFilters);
						paginatedUsers.goToFirstPage();
					}}
					customGroups={customGroups}
					selectedCount={selection.selectedUserIds.size}
					isBulkPending={setMemberships.isPending}
					bulkError={setMemberships.error?.message}
					bulkNotice={bulkNotice}
					onBulkMembershipChange={handleBulkMembershipChange}
					onClearSelection={() => {
						selection.clear();
						setMemberships.reset();
						setBulkNotice('');
					}}
				/>
				<UserAccessTable
					projectUsers={paginatedUsers.page.projectUsers}
					organizationUsers={paginatedUsers.page.organizationUsers}
					currentUserId={session?.user?.id}
					management={management}
					pagination={paginatedUsers.pagination}
					emptyMessage={hasActiveProjectUserFilters(filters) ? 'No users match your filters.' : undefined}
				/>
			</SettingsCard>

			<AddMemberDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				title='Add User to Project'
				onSubmit={handleAdd}
				groupOptions={canManageGroups ? groups : undefined}
			/>

			<EditMemberDialog
				open={!!editMember}
				onOpenChange={(open) => !open && setEditMember(null)}
				member={editMember && toTeamMember(editMember)}
				isAdmin
				roleScope='project'
				availableRoles={USER_ROLES}
				onSubmit={handleEdit}
			/>

			<RemoveMemberDialog
				open={!!removeMember}
				onOpenChange={(open) => !open && setRemoveMember(null)}
				memberName={removeMember?.name ?? ''}
				description='Are you sure you want to remove this user from the project?'
				onConfirm={handleRemove}
			/>

			<ConfirmationDialog
				open={!!resetPasswordMember}
				onOpenChange={(open) => !open && closeResetPasswordDialog()}
				title={`Reset ${resetPasswordMember?.name ?? ''}'s password?`}
				description='Are you sure you want to do this?'
				confirmLabel='Reset password'
				onConfirm={handleResetPassword}
				isPending={resetPassword.isPending}
				preventCloseWhilePending
				error={resetPasswordError}
			/>

			<NewCredentialsDialog
				open={!!credentials}
				onOpenChange={(open) => !open && setCredentials(null)}
				credentials={credentials}
			/>
		</>
	);
}

function toTeamMember(user: ProjectUser): TeamMember {
	return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
}

/** The endpoint caps each request, while a selection can include every user of the project. */
async function setMembershipsInBatches({ groupId, userIds, isMember }: BulkMembershipChange): Promise<void> {
	for (let start = 0; start < userIds.length; start += BULK_MEMBERSHIP_BATCH_SIZE) {
		await trpcClient.userGroup.setMemberships.mutate({
			groupId,
			userIds: userIds.slice(start, start + BULK_MEMBERSHIP_BATCH_SIZE),
			isMember,
		});
	}
}

/** SSO sync owns these memberships, so a manual change would be duplicated or undone. */
function describeSsoManagedUsers(users: ProjectUser[], groupName: string): string {
	if (users.length === 0) {
		return '';
	}
	const names = users.slice(0, LISTED_SKIPPED_USERS_LIMIT).map((user) => user.name);
	const hiddenCount = users.length - names.length;
	const userList = hiddenCount > 0 ? `${names.join(', ')} and ${hiddenCount} more` : names.join(', ');
	return `Skipped ${userList}: SSO manages their membership in ${groupName}.`;
}

/** Only visible users stay selected, so bulk actions never touch users hidden by the current filters. */
function useVisibleUserSelection(visibleUsers: ProjectUser[]) {
	const [checkedUserIds, setCheckedUserIds] = useState<Set<string>>(() => new Set());
	const visibleUserIds = visibleUsers.map((user) => user.id);
	const selectedUserIds = new Set(visibleUserIds.filter((userId) => checkedUserIds.has(userId)));

	const onToggleUser = (userId: string, isSelected: boolean) => {
		setCheckedUserIds((current) => {
			const next = new Set(current);
			if (isSelected) {
				next.add(userId);
			} else {
				next.delete(userId);
			}
			return next;
		});
	};

	const onToggleAll = (isSelected: boolean) => {
		setCheckedUserIds(isSelected ? new Set(visibleUserIds) : new Set());
	};

	const clear = () => {
		setCheckedUserIds(new Set());
	};

	return { selectedUserIds, selectableCount: visibleUserIds.length, onToggleUser, onToggleAll, clear };
}

function UserAccessTable({
	projectUsers,
	organizationUsers,
	currentUserId,
	management,
	pagination,
	emptyMessage = 'No users have access to this project.',
}: ProjectUsersProps & {
	currentUserId?: string;
	management?: UserAccessManagement;
	pagination?: UserSectionsPagination;
	emptyMessage?: string;
}) {
	return (
		<div className='flex flex-col'>
			<UserAccessTableContent
				projectUsers={projectUsers}
				organizationUsers={organizationUsers}
				currentUserId={currentUserId}
				management={management}
				emptyMessage={emptyMessage}
			/>
			{pagination?.isVisible && <TablePagination {...pagination} />}
		</div>
	);
}

function UserAccessTableContent({
	projectUsers,
	organizationUsers,
	currentUserId,
	management,
	emptyMessage,
}: ProjectUsersProps & {
	currentUserId?: string;
	management?: UserAccessManagement;
	emptyMessage: string;
}) {
	const hasUsers = projectUsers.length > 0 || organizationUsers.length > 0;
	const columnCount = management ? (management.groupAccess.canManageGroups ? 5 : 4) : 2;

	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-3xl table-fixed'>
				<TableHeader>
					<TableRow className='hover:bg-transparent [&_th]:h-10 [&_th]:text-xs [&_th]:text-muted-foreground'>
						{management ? (
							<>
								{management.groupAccess.canManageGroups && (
									<TableHead className='w-10 [&>[role=checkbox]]:translate-y-0'>
										<SelectAllUsersCheckbox selection={management.selection} />
									</TableHead>
								)}
								<TableHead className='w-[32%]'>User</TableHead>
								<TableHead className='w-1/5'>Role</TableHead>
								<TableHead className='w-[38%]'>Groups</TableHead>
								<TableHead className='w-[6%]' />
							</>
						) : (
							<>
								<TableHead className='w-3/5'>User</TableHead>
								<TableHead>Role</TableHead>
							</>
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{!hasUsers && (
						<TableRow>
							<TableCell colSpan={columnCount} className='h-24 text-center'>
								{emptyMessage}
							</TableCell>
						</TableRow>
					)}
					{projectUsers.length > 0 && (
						<UserAccessSection
							label='Project Team'
							users={projectUsers}
							columnCount={columnCount}
							currentUserId={currentUserId}
							management={management}
							showMemberActions
						/>
					)}
					{organizationUsers.length > 0 && (
						<UserAccessSection
							label='Organisation Members'
							users={organizationUsers}
							columnCount={columnCount}
							currentUserId={currentUserId}
							management={management}
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
	columnCount,
	currentUserId,
	management,
	showMemberActions = false,
}: {
	label: string;
	users: ProjectUser[];
	columnCount: number;
	currentUserId?: string;
	management?: UserAccessManagement;
	showMemberActions?: boolean;
}) {
	return (
		<>
			<TableRow className='border-y bg-muted/40 hover:bg-muted/40'>
				<TableCell colSpan={columnCount} className='py-2.5 text-xs font-semibold text-muted-foreground'>
					{label}
				</TableCell>
			</TableRow>
			{users.map((user) =>
				management ? (
					<ManagedUserAccessRow
						key={user.id}
						user={user}
						isCurrentUser={user.id === currentUserId}
						management={management}
						showMemberActions={showMemberActions}
					/>
				) : (
					<TableRow key={user.id}>
						<TableCell className='min-w-0 overflow-hidden'>
							<UserIdentity user={user} isCurrentUser={user.id === currentUserId} />
						</TableCell>
						<TableCell className='min-w-0 overflow-hidden'>
							<Badge variant={user.role}>{USER_ROLE_LABELS[user.role]}</Badge>
						</TableCell>
					</TableRow>
				),
			)}
		</>
	);
}

function ManagedUserAccessRow({
	user,
	isCurrentUser,
	management,
	showMemberActions,
}: {
	user: ProjectUser;
	isCurrentUser: boolean;
	management: UserAccessManagement;
	showMemberActions: boolean;
}) {
	const { groupAccess, memberActions, selection, onOpenUser } = management;
	const isSelected = selection.selectedUserIds.has(user.id);

	return (
		<TableRow
			className='cursor-pointer'
			data-state={isSelected ? 'selected' : undefined}
			onClick={() => onOpenUser(user.id)}
		>
			{groupAccess.canManageGroups && (
				<TableCell className='[&>[role=checkbox]]:translate-y-0' onClick={(event) => event.stopPropagation()}>
					<Checkbox
						checked={isSelected}
						onCheckedChange={(checked) => selection.onToggleUser(user.id, checked === true)}
						aria-label={`Select ${user.name}`}
					/>
				</TableCell>
			)}
			<TableCell className='min-w-0 overflow-hidden'>
				<UserIdentity
					user={user}
					isCurrentUser={isCurrentUser}
					name={
						<Link
							to='/settings/project/user-groups/users/$userId'
							params={{ userId: user.id }}
							search={{ tab: 'features' }}
							className='min-w-0 truncate font-medium hover:underline'
							title={user.name}
							onClick={(event) => event.stopPropagation()}
						>
							{user.name}
						</Link>
					}
				/>
			</TableCell>
			<TableCell className='min-w-0 overflow-hidden'>
				<Badge variant={user.role}>{USER_ROLE_LABELS[user.role]}</Badge>
			</TableCell>
			<TableCell className='min-w-0 overflow-hidden'>
				<UserGroupsCell user={user} groupAccess={groupAccess} />
			</TableCell>
			<TableCell className='text-right'>
				{showMemberActions && !isCurrentUser && <MemberRowActions user={user} actions={memberActions} />}
			</TableCell>
		</TableRow>
	);
}

function SelectAllUsersCheckbox({ selection }: { selection: UserSelection }) {
	const { selectableCount } = selection;
	const selectedCount = selection.selectedUserIds.size;
	const checked =
		selectableCount > 0 && selectedCount === selectableCount ? true : selectedCount > 0 ? 'indeterminate' : false;

	return (
		<Checkbox
			checked={checked}
			disabled={selectableCount === 0}
			onCheckedChange={() => selection.onToggleAll(checked !== true)}
			aria-label='Select all users'
			className='data-[state=indeterminate]:bg-primary/15 data-[state=indeterminate]:text-primary/70 data-[state=indeterminate]:shadow-none'
		/>
	);
}

function UserIdentity({ user, isCurrentUser, name }: { user: ProjectUser; isCurrentUser: boolean; name?: ReactNode }) {
	return (
		<div className='flex min-w-0 flex-col'>
			<div className='flex min-w-0 items-center gap-1'>
				{name ?? (
					<span className='min-w-0 truncate font-medium' title={user.name}>
						{user.name}
					</span>
				)}
				{isCurrentUser && <span className='shrink-0 text-xs text-muted-foreground'>(you)</span>}
			</div>
			<span className='truncate text-xs text-muted-foreground' title={user.email}>
				{user.email}
				{user.status ? ` · ${user.status}` : ''}
			</span>
		</div>
	);
}

function MemberRowActions({ user, actions }: { user: ProjectUser; actions: ProjectMemberActions }) {
	const { onEdit, onRemove, onResetPassword } = actions;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					aria-label={`Actions for ${user.name}`}
					onClick={(event) => event.stopPropagation()}
				>
					<EllipsisVertical className='size-4' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' onClick={(event) => event.stopPropagation()}>
				<DropdownMenuGroup>
					<DropdownMenuItem onSelect={() => onEdit(user)}>Edit user</DropdownMenuItem>
					{onResetPassword && (
						<DropdownMenuItem onSelect={() => onResetPassword(user)}>Reset password</DropdownMenuItem>
					)}
					<DropdownMenuItem className='text-destructive' onSelect={() => onRemove(user)}>
						Remove
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function UserGroupsCell({ user, groupAccess }: { user: ProjectUser; groupAccess: GroupAccess }) {
	const { groups, membershipKeys, ssoMembershipKeys } = groupAccess;
	const queryClient = useQueryClient();
	const setMembership = useMutation(
		trpc.userGroup.setMembership.mutationOptions({
			onSuccess: () => invalidateUserGroupQueries(queryClient),
		}),
	);
	const setGroupMembership = (groupId: string, isMember: boolean) => {
		setMembership.mutate({ groupId, userId: user.id, isMember });
	};
	const tokens = groups
		.filter((group) => group.isDefault || membershipKeys.has(`${group.id}:${user.id}`))
		.map((group) =>
			toGroupToken(
				group,
				ssoMembershipKeys.has(`${group.id}:${user.id}`),
				groupAccess.canManageGroups ? setGroupMembership : undefined,
			),
		);
	const selectedGroupLabel = tokens.length > 0 ? tokens.map((token) => token.name).join(', ') : 'No groups';
	const hasGroupsToAdd = tokens.length < groups.length;

	return (
		<UserGroupTokenField
			tokens={tokens}
			triggerLabel={`Manage groups for ${user.name}. Current groups: ${selectedGroupLabel}`}
			placeholder={hasGroupsToAdd ? 'Add groups' : ''}
			readOnly={!groupAccess.canManageGroups}
			isRemoveDisabled={setMembership.isPending}
		>
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
							onCheckedChange={(checked) => setGroupMembership(group.id, checked === true)}
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
		</UserGroupTokenField>
	);
}

function toGroupToken(
	group: AssignableUserGroup,
	isManagedBySso: boolean,
	setGroupMembership?: (groupId: string, isMember: boolean) => void,
): UserGroupToken {
	if (group.isDefault) {
		return { key: group.id, name: group.name, title: 'Added automatically' };
	}
	if (isManagedBySso) {
		return { key: group.id, name: group.name, title: 'Managed by SSO' };
	}
	return setGroupMembership
		? { key: group.id, name: group.name, onRemove: () => setGroupMembership(group.id, false) }
		: { key: group.id, name: group.name, title: 'Managed by user_groups.yaml' };
}
