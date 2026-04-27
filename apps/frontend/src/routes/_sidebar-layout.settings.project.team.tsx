import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { USER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import {
	TeamMembersList,
	AddMemberDialog,
	EditMemberDialog,
	RemoveMemberDialog,
	NewCredentialsDialog,
} from '@/components/settings/team';
import { SettingsCard } from '@/components/ui/settings-card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/team')({
	component: ProjectTeamTabPage,
});

function ProjectTeamTabPage() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const usersWithRoles = useQuery(trpc.project.listAllUsersWithRoles.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editMember, setEditMember] = useState<TeamMember | null>(null);
	const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

	const members: TeamMember[] =
		usersWithRoles.data?.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			role: u.role,
		})) ?? [];

	const addUser = useMutation(trpc.user.addUserToProject.mutationOptions());
	const modifyUser = useMutation(trpc.user.modify.mutationOptions());
	const removeUser = useMutation(trpc.project.removeProjectMember.mutationOptions());
	const resetPassword = useMutation(trpc.account.resetPassword.mutationOptions());

	const invalidateMembers = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.project.listAllUsersWithRoles.queryKey() });
	}, [queryClient]);

	const handleAdd = async (data: { email: string; name?: string }) => {
		try {
			const result = await addUser.mutateAsync({
				email: data.email,
				name: data.name,
			});
			invalidateMembers();
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
		invalidateMembers();
		if (session?.user) {
			await queryClient.invalidateQueries({ queryKey: ['session'] });
		}
	};

	const handleRemove = async () => {
		if (!removeMember) {
			return;
		}
		await removeUser.mutateAsync({ userId: removeMember.id });
		invalidateMembers();
	};

	const handleResetPassword = async () => {
		if (!resetPasswordMember) {
			return;
		}
		const result = await resetPassword.mutateAsync({ userId: resetPasswordMember.id });
		setResetPasswordMember(null);
		setCredentials({ email: resetPasswordMember.email, password: result.password });
	};

	return (
		<>
			<SettingsCard
				title='Team Members'
				description='Manage the members of your project.'
				divide
				action={
					isAdmin ? (
						<Button variant='secondary' size='sm' onClick={() => setIsAddOpen(true)}>
							<Plus />
							Add Member
						</Button>
					) : undefined
				}
			>
				{usersWithRoles.isLoading ? (
					<div className='text-sm text-muted-foreground'>Loading users...</div>
				) : (
					<TeamMembersList
						members={members}
						currentUserId={session?.user?.id}
						isAdmin={isAdmin}
						onEdit={setEditMember}
						onRemove={setRemoveMember}
						extraActions={(member) => (
							<ResetPasswordAction onClick={() => setResetPasswordMember(member)} />
						)}
					/>
				)}
			</SettingsCard>

			<AddMemberDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				title='Add User to Project'
				onSubmit={handleAdd}
			/>

			<EditMemberDialog
				open={!!editMember}
				onOpenChange={(open) => !open && setEditMember(null)}
				member={editMember}
				isAdmin={isAdmin}
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

			<Dialog open={!!resetPasswordMember} onOpenChange={(open) => !open && setResetPasswordMember(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset {resetPasswordMember?.name}'s password?</DialogTitle>
					</DialogHeader>
					<p className='text-sm text-muted-foreground'>Are you sure you want to do this?</p>
					<div className='flex justify-end gap-2'>
						<Button variant='outline' onClick={() => setResetPasswordMember(null)}>
							Cancel
						</Button>
						<Button variant='destructive' onClick={handleResetPassword}>
							Reset password
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<NewCredentialsDialog
				open={!!credentials}
				onOpenChange={(open) => !open && setCredentials(null)}
				credentials={credentials}
			/>
		</>
	);
}

function ResetPasswordAction({ onClick }: { onClick: () => void }) {
	return <DropdownMenuItem onSelect={onClick}>Reset password</DropdownMenuItem>;
}
