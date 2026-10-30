import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team/types';
import { CloudBillingChangeDialog } from '@/components/settings/cloud-billing-change-dialog';
import { TeamMembersList } from '@/components/settings/team/team-members-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';

export type CloudSeatCandidate = {
	userId: string;
	name: string;
	email: string;
	membershipClass: 'org_admin' | 'org_member' | 'project_only';
	storedOrgRole: string | null;
	storedProjectRoles?: UserRole[];
	isSelected: boolean;
	isSeated: boolean;
	isReadOnly: boolean;
};

type BillingPreview = React.ComponentProps<typeof CloudBillingChangeDialog>['preview'];

export function seatCandidateToTeamMember(candidate: CloudSeatCandidate): TeamMember {
	return {
		id: candidate.userId,
		name: candidate.name,
		email: candidate.email,
		role:
			(candidate.storedOrgRole as UserRole | null) ??
			candidate.storedProjectRoles?.find((role) => role !== 'viewer') ??
			'user',
		status: 'active',
		membershipSource: candidate.membershipClass === 'project_only' ? 'project' : 'organization',
	};
}

export function getNextSeatSelection(
	candidates: CloudSeatCandidate[],
	userId: string,
	access: 'seated' | 'read-only',
): string[] {
	const selectedUserIds = candidates
		.filter(({ storedOrgRole, isSeated }) => storedOrgRole !== 'admin' && isSeated)
		.map((candidate) => candidate.userId);
	return access === 'seated'
		? [...new Set([...selectedUserIds, userId])]
		: selectedUserIds.filter((selectedUserId) => selectedUserId !== userId);
}

export function CloudBillingSeatsCard({
	tier,
	seatQuantity,
	seatLimit,
	availableSeats,
	candidates,
	disabled,
	onPreviewSeatChange,
	onConfirmSeatChange,
	onSaveSeatSelection,
}: {
	tier: string;
	seatQuantity: number | null;
	seatLimit: number | null;
	availableSeats: number | null;
	candidates: CloudSeatCandidate[];
	disabled?: boolean;
	onPreviewSeatChange?: (quantity: number) => Promise<BillingPreview>;
	onConfirmSeatChange?: (token: string) => Promise<unknown>;
	onSaveSeatSelection?: (selectedUserIds: string[]) => Promise<unknown>;
}) {
	const [quantity, setQuantity] = useState(Math.min(TEAM_MAX_SEATS, seatQuantity ?? TEAM_MIN_SEATS));
	const [preview, setPreview] = useState<BillingPreview>(null);
	const [error, setError] = useState<string | null>(null);
	const [accessError, setAccessError] = useState<string | null>(null);

	useEffect(() => setQuantity(Math.min(TEAM_MAX_SEATS, seatQuantity ?? TEAM_MIN_SEATS)), [seatQuantity]);

	const seatedMembers = candidates.filter(({ isSeated }) => isSeated);
	const capacity = tier === 'team' ? seatQuantity : tier === 'free' ? (seatLimit ?? 3) : null;
	const accessByUserId = Object.fromEntries(
		candidates.map(({ userId, isSeated }) => [userId, isSeated ? 'seated' : 'read-only'] as const),
	);
	const accessDisabledByUserId = Object.fromEntries(
		candidates.map(({ userId, storedOrgRole }) => [userId, storedOrgRole === 'admin' || Boolean(disabled)]),
	);

	const changeAccess = async (member: TeamMember, access: 'seated' | 'read-only') => {
		if (!onSaveSeatSelection) {
			return;
		}
		if (access === 'seated' && availableSeats !== null && availableSeats <= 0) {
			setAccessError('No seats are available. Add capacity first.');
			return;
		}
		setAccessError(null);
		try {
			await onSaveSeatSelection(getNextSeatSelection(candidates, member.id, access));
		} catch (caught) {
			setAccessError(caught instanceof Error ? caught.message : 'Unable to update seat access.');
		}
	};
	const seatsSummary =
		tier === 'team'
			? `${seatQuantity ?? '—'} purchased seats`
			: tier === 'free'
				? `${seatLimit ?? 3} seats included`
				: tier === 'trial'
					? null
					: 'No seat limit';

	const previewSeatChange = async () => {
		if (!onPreviewSeatChange) {
			return;
		}
		setError(null);
		try {
			setPreview(await onPreviewSeatChange(quantity));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to preview the seat change.');
		}
	};

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard
				title='Seat usage'
				description='Seats give people full access. Viewers and read-only members are always free.'
			>
				<div className='flex flex-wrap items-start justify-between gap-x-10 gap-y-4'>
					<div className='flex flex-wrap gap-x-10 gap-y-4'>
						<SeatStat label='Seats in use' value={seatedMembers.length} />
						<SeatStat label='Available seats' value={availableSeats ?? 'Unlimited'} />
						{capacity !== null && (
							<SeatStat label={tier === 'team' ? 'Purchased' : 'Included'} value={capacity} />
						)}
					</div>
					<Button variant='secondary' size='sm' asChild>
						<Link to='/settings/organization/members'>
							<Users />
							Manage members
						</Link>
					</Button>
				</div>
				{capacity !== null && <SeatUsageBar used={seatedMembers.length} capacity={capacity} />}
				{seatsSummary && <p className='text-xs text-muted-foreground'>{seatsSummary}</p>}
				{tier === 'team' && onPreviewSeatChange && (
					<div className='flex flex-col gap-3 border-t border-border pt-4'>
						<div>
							<p className='text-sm font-medium text-foreground'>Paid capacity</p>
							<p className='mt-1 text-xs text-muted-foreground'>
								Team supports {TEAM_MIN_SEATS} to {TEAM_MAX_SEATS} seats. You will review the price
								before any billing change is applied.
							</p>
						</div>
						<div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
							<label className='flex flex-col gap-1 text-sm font-medium'>
								Number of seats
								<Input
									type='number'
									min={TEAM_MIN_SEATS}
									max={TEAM_MAX_SEATS}
									value={quantity}
									onChange={(event) =>
										setQuantity(
											Number.isFinite(event.target.valueAsNumber)
												? Math.min(
														TEAM_MAX_SEATS,
														Math.max(
															TEAM_MIN_SEATS,
															Math.trunc(event.target.valueAsNumber),
														),
													)
												: TEAM_MIN_SEATS,
										)
									}
									className='w-full sm:w-28'
								/>
							</label>
							<Button
								disabled={disabled || quantity === seatQuantity}
								onClick={() => void previewSeatChange()}
							>
								Review seat change
							</Button>
						</div>
						{error && (
							<p className='text-sm text-destructive' role='alert'>
								{error}
							</p>
						)}
					</div>
				)}
			</SettingsCard>

			<SettingsCard
				flush
				title='Members'
				description='Seated members have full access. Read-only members keep their data and can be seated at any time.'
			>
				{accessError && (
					<p className='border-b border-border p-4 text-sm text-destructive' role='alert'>
						{accessError}
					</p>
				)}
				<TeamMembersList
					members={candidates.map(seatCandidateToTeamMember)}
					isAdmin
					accessByUserId={accessByUserId}
					accessDisabledByUserId={accessDisabledByUserId}
					accessSummary={capacity !== null ? `${seatedMembers.length}/${capacity}` : undefined}
					onAccessChange={
						onSaveSeatSelection ? (member, access) => void changeAccess(member, access) : undefined
					}
				/>
			</SettingsCard>

			<CloudBillingChangeDialog
				open={preview !== null}
				onOpenChange={(open) => !open && setPreview(null)}
				title='Confirm seat change'
				preview={preview}
				onRefresh={previewSeatChange}
				onConfirm={
					onConfirmSeatChange
						? async (token) => {
								await onConfirmSeatChange(token);
								setPreview(null);
							}
						: undefined
				}
			/>
		</div>
	);
}

function SeatStat({ label, value }: { label: string; value: number | string }) {
	return (
		<div className='flex flex-col gap-1'>
			<span className='text-xl font-semibold text-foreground tabular-nums'>{value}</span>
			<span className='text-xs text-muted-foreground'>{label}</span>
		</div>
	);
}

function SeatUsageBar({ used, capacity }: { used: number; capacity: number }) {
	const full = used >= capacity;
	const width = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
	return (
		<div
			role='progressbar'
			aria-label='Seat usage'
			aria-valuemin={0}
			aria-valuemax={capacity}
			aria-valuenow={Math.min(used, capacity)}
			className='h-1.5 overflow-hidden rounded-full bg-muted'
		>
			<div
				className={cn('h-full rounded-full bg-primary transition-[width]', full && 'bg-amber-500')}
				style={{ width: `${width}%` }}
			/>
		</div>
	);
}
