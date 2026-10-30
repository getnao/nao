import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Info, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ORG_MEMBER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import type { CloudSeatCandidate } from '@/components/settings/cloud-billing-seats-card';
import type { MemberAccessState } from '@/components/settings/member-access-badge';
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
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { getBrowserBillingCurrency } from '@/lib/billing-currency';
import { trpc } from '@/main';

export function OrgMembers() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const membersQuery = useQuery(trpc.organization.getMembers.queryOptions());
	const userCountsQuery = useQuery(trpc.organization.getUserCounts.queryOptions());
	const { isOrgAdmin } = usePermissions();
	const isCloud = useIsCloud();
	const billingAccess = useCloudBillingAccess({ enabled: isCloud });
	const billingStatus = useQuery({
		...trpc.billing.getStatus.queryOptions({ currency: getBrowserBillingCurrency() }),
		enabled: isCloud && isOrgAdmin && billingAccess.data?.freeTierEnabled === true,
	});

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [editMember, setEditMember] = useState<TeamMember | null>(null);
	const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
	const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
	const [seatAccessError, setSeatAccessError] = useState<string | null>(null);
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

	const invalidateMembers = useCallback(() => {
		return Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.organization.getMembers.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.organization.getUserCounts.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.billing.getAccess.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.billing.getStatus.queryKey() }),
		]);
	}, [queryClient]);

	const addMember = useMutation(trpc.organization.addMember.mutationOptions());
	const modifyMember = useMutation(trpc.organization.modifyMember.mutationOptions());
	const removeOrgMember = useMutation(trpc.organization.removeMember.mutationOptions());
	const resetPassword = useMutation(trpc.organization.resetMemberPassword.mutationOptions());
	const selectSeats = useMutation(trpc.billing.selectSeats.mutationOptions());

	const organizationMembers: TeamMember[] =
		membersQuery.data?.map((member) => ({
			id: member.id,
			name: member.name,
			email: member.email,
			role: member.role as UserRole,
			status: member.status,
			membershipSource: 'organization',
		})) ?? [];
	const cloudBillingStatus =
		billingStatus.data && 'access' in billingStatus.data && 'seatCandidates' in billingStatus.data
			? billingStatus.data
			: undefined;
	const seatCandidates: CloudSeatCandidate[] = cloudBillingStatus?.seatCandidates ?? [];
	const projectMembers: TeamMember[] = seatCandidates
		.filter((candidate) => candidate.membershipClass === 'project_only')
		.map((candidate) => ({
			id: candidate.userId,
			name: candidate.name,
			email: candidate.email,
			role: candidate.storedProjectRoles?.find((role) => role !== 'viewer') ?? 'user',
			status: 'active',
			membershipSource: 'project',
		}));
	const members = [...organizationMembers, ...projectMembers];
	const accessByUserId: Record<string, MemberAccessState> | undefined = cloudBillingStatus
		? Object.fromEntries(
				members.map((member) => {
					const candidate = seatCandidates.find(({ userId }) => userId === member.id);
					return [member.id, candidate ? (candidate.isSeated ? 'seated' : 'read-only') : 'viewer'] as const;
				}),
			)
		: undefined;
	const assignmentsEditable =
		cloudBillingStatus?.access.tier === 'free' ||
		cloudBillingStatus?.access.tier === 'team' ||
		cloudBillingStatus?.access.tier === 'trial';
	const seatCapacity =
		cloudBillingStatus?.access.tier === 'team'
			? cloudBillingStatus.access.seatQuantity
			: cloudBillingStatus?.access.tier === 'free'
				? cloudBillingStatus.access.seatLimit
				: null;
	const accessSummary =
		seatCapacity === null || seatCapacity === undefined
			? undefined
			: `${seatCandidates.filter(({ isSeated }) => isSeated).length}/${seatCapacity}`;
	const accessDisabledByUserId = Object.fromEntries(
		seatCandidates.map((candidate) => [
			candidate.userId,
			candidate.storedOrgRole === 'admin' || !assignmentsEditable || selectSeats.isPending,
		]),
	);

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
			return result;
		} catch (err: any) {
			if (err.message === 'USER_DOES_NOT_EXIST') {
				return { needsName: true };
			}
			throw err;
		}
	};

	const handleEdit = async (data: { userId: string; name?: string; newRole?: UserRole }) => {
		const result = await modifyMember.mutateAsync({
			...data,
			newRole: data.newRole as (typeof ORG_MEMBER_ROLES)[number] | undefined,
		});
		invalidateMembers();
		if (session?.user) {
			await queryClient.invalidateQueries({ queryKey: ['session'] });
		}
		return result;
	};

	const handleRemove = async () => {
		if (!removeMember) {
			return;
		}
		await removeOrgMember.mutateAsync({ userId: removeMember.id });
		invalidateMembers();
	};

	const handleAccessChange = async (member: TeamMember, access: 'seated' | 'read-only') => {
		const candidate = seatCandidates.find(({ userId }) => userId === member.id);
		if (!candidate || candidate.storedOrgRole === 'admin') {
			return;
		}
		const availableSeats = cloudBillingStatus?.access.availableSeats;
		if (access === 'seated' && availableSeats !== null && availableSeats !== undefined && availableSeats <= 0) {
			setSeatAccessError('No seats are available. Add capacity in Billing → Seats first.');
			return;
		}

		const selectedUserIds = seatCandidates
			.filter(({ storedOrgRole, isSeated }) => storedOrgRole !== 'admin' && isSeated)
			.map(({ userId }) => userId);
		const nextSelectedUserIds =
			access === 'seated'
				? [...new Set([...selectedUserIds, member.id])]
				: selectedUserIds.filter((userId) => userId !== member.id);

		setSeatAccessError(null);
		try {
			await selectSeats.mutateAsync({ selectedUserIds: nextSelectedUserIds });
			await invalidateMembers();
		} catch (error) {
			setSeatAccessError(error instanceof Error ? error.message : 'Unable to update seat access.');
		}
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
			<div className='flex flex-col gap-5'>
				<div className='flex flex-wrap gap-x-10 gap-y-4 rounded-xl border border-border bg-background p-4'>
					<OrgUserStat label='Organization members' value={membersQuery.data?.length} />
					<OrgUserStat
						label='People with access'
						value={userCountsQuery.data?.totalUsers}
						hint='Organization members plus people with project-only access, including users created automatically by integrations.'
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
					{seatAccessError && (
						<p className='border-b border-border p-4 text-sm text-destructive' role='alert'>
							{seatAccessError}{' '}
							<Link
								to='/settings/organization/billing'
								search={{ tab: 'seats' }}
								className='font-medium underline underline-offset-4'
							>
								Manage seats
							</Link>
						</p>
					)}
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
							accessByUserId={accessByUserId}
							accessDisabledByUserId={accessDisabledByUserId}
							accessSummary={accessSummary}
							onAccessChange={
								assignmentsEditable
									? (member, access) => void handleAccessChange(member, access)
									: undefined
							}
							extraActions={
								isCloud
									? undefined
									: (member) => (
											<ResetPasswordAction onClick={() => openResetPasswordDialog(member)} />
										)
							}
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
