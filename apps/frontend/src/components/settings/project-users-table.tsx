import { USER_ROLE_LABELS, USER_ROLES } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, EllipsisVertical, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MemberStatus, UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import {
	AddMemberDialog,
	EditMemberDialog,
	NewCredentialsDialog,
	RemoveMemberDialog,
} from '@/components/settings/team';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { invalidateUserGroupQueries } from '@/components/settings/user-group-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useIsCloud } from '@/hooks/use-nao-mode';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

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
}

interface UserAccessManagement {
	groupAccess: GroupAccess;
	memberActions: ProjectMemberActions;
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

	return (
		<SettingsCard title='Members' description='People who have access to this project.' flush>
			<UserAccessTable
				projectUsers={projectUsers}
				organizationUsers={organizationUsers}
				currentUserId={session?.user?.id}
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

	const addUser = useMutation(trpc.user.addUserToProject.mutationOptions());
	const modifyUser = useMutation(trpc.user.modify.mutationOptions());
	const removeUser = useMutation(trpc.project.removeProjectMember.mutationOptions());
	const resetPassword = useMutation(trpc.account.resetPassword.mutationOptions());

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

	const management: UserAccessManagement = {
		groupAccess: { groups, membershipKeys, ssoMembershipKeys },
		memberActions: {
			onEdit: setEditMember,
			onRemove: setRemoveMember,
			onResetPassword: isCloud ? undefined : setResetPasswordMember,
		},
		onOpenUser,
	};

	return (
		<>
			<SettingsCard
				title='Members'
				description='Add members to the project and assign them to groups.'
				flush
				action={
					<Button onClick={() => setIsAddOpen(true)}>
						<Plus />
						Add member
					</Button>
				}
			>
				<UserAccessTable
					projectUsers={projectUsers}
					organizationUsers={organizationUsers}
					currentUserId={session?.user?.id}
					management={management}
				/>
			</SettingsCard>

			<AddMemberDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				title='Add User to Project'
				onSubmit={handleAdd}
				groupOptions={groups}
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

function UserAccessTable({
	projectUsers,
	organizationUsers,
	currentUserId,
	management,
}: ProjectUsersProps & {
	currentUserId?: string;
	management?: UserAccessManagement;
}) {
	const hasUsers = projectUsers.length > 0 || organizationUsers.length > 0;
	const columnCount = management ? 4 : 2;

	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-3xl table-fixed'>
				<TableHeader>
					<TableRow className='[&_th]:h-12'>
						{management ? (
							<>
								<TableHead className='w-[36%]'>User</TableHead>
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
								No users have access to this project.
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
	const { groupAccess, memberActions, onOpenUser } = management;

	return (
		<TableRow className='cursor-pointer hover:bg-primary/10' onClick={() => onOpenUser(user.id)}>
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
