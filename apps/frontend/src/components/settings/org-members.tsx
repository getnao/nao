import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ORG_MEMBER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import {
	AddMemberDialog,
	EditMemberDialog,
	NewCredentialsDialog,
	RemoveMemberDialog,
	TeamMembersList,
} from '@/components/settings/team';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SettingsCard } from '@/components/ui/settings-card';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function OrgMembers() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const membersQuery = useQuery(trpc.organization.getMembers.queryOptions());
	const { isOrgAdmin } = usePermissions();
	const isCloud = useIsCloud();

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editMember, setEditMember] = useState<TeamMember | null>(null);
	const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
	const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

	const invalidateMembers = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.organization.getMembers.queryKey() });
	}, [queryClient]);

	const addMember = useMutation(trpc.organization.addMember.mutationOptions());
	const modifyMember = useMutation(trpc.organization.modifyMember.mutationOptions());
	const removeOrgMember = useMutation(trpc.organization.removeMember.mutationOptions());
	const resetPassword = useMutation(trpc.organization.resetMemberPassword.mutationOptions());

	const members: TeamMember[] =
		membersQuery.data?.map((member) => ({
			id: member.id,
			name: member.name,
			email: member.email,
			role: member.role as UserRole,
			status: member.status,
		})) ?? [];

	const handleAdd = async (data: { email: string; name?: string }) => {
		try {
			const result = await addMember.mutateAsync({
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
		await modifyMember.mutateAsync({
			...data,
			newRole: data.newRole as (typeof ORG_MEMBER_ROLES)[number] | undefined,
		});
		invalidateMembers();
		if (session?.user) {
			await queryClient.invalidateQueries({ queryKey: ['session'] });
		}
	};

	const handleRemove = async () => {
		if (!removeMember) {
			return;
		}
		await removeOrgMember.mutateAsync({ userId: removeMember.id });
		invalidateMembers();
	};

	const handleResetPassword = async () => {
		if (!resetPasswordMember) {
			return;
		}
		try {
			const result = await resetPassword.mutateAsync({ userId: resetPasswordMember.id });
			setResetPasswordError(null);
			setResetPasswordMember(null);
			setCredentials({ email: resetPasswordMember.email, password: result.password });
		} catch (error) {
			setResetPasswordError(error instanceof Error ? error.message : 'Failed to reset password.');
		}
	};

	const openResetPasswordDialog = (member: TeamMember) => {
		setResetPasswordError(null);
		setResetPasswordMember(member);
	};

	const closeResetPasswordDialog = () => {
		setResetPasswordError(null);
		setResetPasswordMember(null);
	};

	return (
		<>
			<SettingsCard
				flush
				action={
					isOrgAdmin ? (
						<Button variant='secondary' size='sm' onClick={() => setIsAddOpen(true)}>
							<Plus />
							Add Member
						</Button>
					) : undefined
				}
			>
				{membersQuery.isLoading ? (
					<div className='p-4 text-sm text-muted-foreground'>Loading members...</div>
				) : membersQuery.isError ? (
					<div className='p-4 text-sm text-destructive'>
						<p>Failed to load members.</p>
						<Button variant='ghost' size='sm' className='mt-2' onClick={() => membersQuery.refetch()}>
							Retry
						</Button>
					</div>
				) : (
					<TeamMembersList
						members={members}
						currentUserId={session?.user?.id}
						isAdmin={isOrgAdmin}
						onEdit={setEditMember}
						onRemove={setRemoveMember}
						extraActions={
							isCloud
								? undefined
								: (member) => <ResetPasswordAction onClick={() => openResetPasswordDialog(member)} />
						}
					/>
				)}
			</SettingsCard>

			<AddMemberDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				title='Add Member to Organization'
				onSubmit={handleAdd}
			/>

			<EditMemberDialog
				open={!!editMember}
				onOpenChange={(open) => !open && setEditMember(null)}
				member={editMember}
				isAdmin={isOrgAdmin}
				availableRoles={ORG_MEMBER_ROLES}
				onSubmit={handleEdit}
			/>

			<RemoveMemberDialog
				open={!!removeMember}
				onOpenChange={(open) => !open && setRemoveMember(null)}
				memberName={removeMember?.name ?? ''}
				description='This will remove the user from the organization. They will lose access to all projects within it.'
				onConfirm={handleRemove}
			/>

			<Dialog open={!!resetPasswordMember} onOpenChange={(open) => !open && closeResetPasswordDialog()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset {resetPasswordMember?.name}'s password?</DialogTitle>
					</DialogHeader>
					<p className='text-sm text-muted-foreground'>Are you sure you want to do this?</p>
					{resetPasswordError && <p className='text-sm text-destructive'>{resetPasswordError}</p>}
					<div className='flex justify-end gap-2'>
						<Button variant='outline' onClick={closeResetPasswordDialog}>
							Cancel
						</Button>
						<Button variant='destructive' onClick={handleResetPassword} disabled={resetPassword.isPending}>
							{resetPassword.isPending ? 'Resetting…' : 'Reset password'}
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
