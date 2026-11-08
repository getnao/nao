import { ORG_MEMBER_ROLES } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
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
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SettingsCard } from '@/components/ui/settings-card';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function OrgMembers() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const membersQuery = useQuery(trpc.organization.getMembers.queryOptions());
	const userCountsQuery = useQuery(trpc.organization.getUserCounts.queryOptions());
	const { isOrgAdmin } = usePermissions();
	const isCloud = useIsCloud();

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editMember, setEditMember] = useState<TeamMember | null>(null);
	const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
	const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
	const [resetTwoFactorMember, setResetTwoFactorMember] = useState<TeamMember | null>(null);
	const [restartGraceMember, setRestartGraceMember] = useState<TeamMember | null>(null);

	const invalidateMembers = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.organization.getMembers.queryKey() });
	}, [queryClient]);

	const addMember = useMutation(trpc.organization.addMember.mutationOptions());
	const modifyMember = useMutation(trpc.organization.modifyMember.mutationOptions());
	const removeOrgMember = useMutation(trpc.organization.removeMember.mutationOptions());
	const resetPassword = useMutation(trpc.organization.resetMemberPassword.mutationOptions());
	const resetTwoFactor = useMutation(trpc.organization.resetMemberTwoFactor.mutationOptions());
	const restartGracePeriod = useMutation(trpc.organization.restartMemberTwoFactorGracePeriod.mutationOptions());

	const members: TeamMember[] =
		membersQuery.data?.map((member) => ({
			id: member.id,
			name: member.name,
			email: member.email,
			role: member.role as UserRole,
			status: member.status,
			twoFactorEnabled: member.twoFactorEnabled,
			twoFactorDeadline: member.twoFactorDeadline,
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

	const handleResetTwoFactor = () => {
		if (!resetTwoFactorMember) {
			return;
		}
		resetTwoFactor.mutate(
			{ userId: resetTwoFactorMember.id },
			{
				onSuccess: () => {
					invalidateMembers();
					setResetTwoFactorMember(null);
				},
			},
		);
	};

	const closeResetTwoFactorDialog = () => {
		resetTwoFactor.reset();
		setResetTwoFactorMember(null);
	};

	const handleRestartGracePeriod = () => {
		if (!restartGraceMember) {
			return;
		}
		restartGracePeriod.mutate(
			{ userId: restartGraceMember.id },
			{
				onSuccess: () => {
					invalidateMembers();
					closeRestartGraceDialog();
				},
			},
		);
	};

	const closeRestartGraceDialog = () => {
		restartGracePeriod.reset();
		setRestartGraceMember(null);
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
			<div className='flex flex-col gap-5'>
				<div className='flex flex-wrap gap-x-10 gap-y-4 rounded-xl border border-border bg-background p-4'>
					<OrgUserStat label='Organization members' value={membersQuery.data?.length} />
					<OrgUserStat
						label='People with access'
						value={userCountsQuery.data?.totalUsers}
						hint="Organization members plus people added directly to a project from its Users & Groups page, or created automatically by Slack. They aren't in the list below; see each project's user list."
					/>
					<OrgUserStat
						label='Active in the last 90 days'
						value={userCountsQuery.data?.activeUsers}
						hint='Distinct people who sent at least one message on any channel. This is the number that maps to licensed seats at renewal.'
					/>
				</div>
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
							extraActions={(member) => (
								<>
									{!isCloud && (
										<ResetPasswordAction onClick={() => openResetPasswordDialog(member)} />
									)}
									{member.twoFactorEnabled && (
										<DropdownMenuItem onSelect={() => setResetTwoFactorMember(member)}>
											Reset two-factor authentication
										</DropdownMenuItem>
									)}
									{member.twoFactorDeadline && (
										<DropdownMenuItem onSelect={() => setRestartGraceMember(member)}>
											Restart two-factor grace period
										</DropdownMenuItem>
									)}
								</>
							)}
						/>
					)}
				</SettingsCard>
			</div>

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
				roleScope='organization'
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
						<Button variant='outline' className='rounded-full' onClick={closeResetPasswordDialog}>
							Cancel
						</Button>
						<Button
							variant='destructive'
							className='rounded-full'
							onClick={handleResetPassword}
							disabled={resetPassword.isPending}
						>
							{resetPassword.isPending ? 'Resetting…' : 'Reset password'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<ConfirmationDialog
				open={!!resetTwoFactorMember}
				onOpenChange={(open) => !open && closeResetTwoFactorDialog()}
				title={`Reset ${resetTwoFactorMember?.name}'s two-factor authentication?`}
				description='They will log in with their password only, and can set up two-factor authentication again from their account settings.'
				confirmLabel='Reset'
				onConfirm={handleResetTwoFactor}
				isPending={resetTwoFactor.isPending}
				preventCloseWhilePending
				error={resetTwoFactor.error?.message}
			/>

			<ConfirmationDialog
				open={!!restartGraceMember}
				onOpenChange={(open) => !open && closeRestartGraceDialog()}
				title={`Give ${restartGraceMember?.name} more time to set up two-factor authentication?`}
				description='Their grace period starts over today. They can use the app normally until it ends.'
				confirmLabel='Restart grace period'
				confirmVariant='default'
				onConfirm={handleRestartGracePeriod}
				isPending={restartGracePeriod.isPending}
				preventCloseWhilePending
				error={restartGracePeriod.error?.message}
			/>

			<NewCredentialsDialog
				open={!!credentials}
				onOpenChange={(open) => !open && setCredentials(null)}
				credentials={credentials}
			/>
		</>
	);
}

function OrgUserStat({ label, value, hint }: { label: string; value?: number; hint?: string }) {
	const caption = (
		<span className='flex items-center gap-1 text-xs text-muted-foreground'>
			{label}
			{hint && <Info className='size-3' />}
		</span>
	);

	return (
		<div className='flex flex-col gap-1'>
			<span className='text-xl font-semibold text-foreground tabular-nums'>{value ?? '—'}</span>
			{hint ? <SimpleTooltip content={hint}>{caption}</SimpleTooltip> : caption}
		</div>
	);
}

function ResetPasswordAction({ onClick }: { onClick: () => void }) {
	return <DropdownMenuItem onSelect={onClick}>Reset password</DropdownMenuItem>;
}
