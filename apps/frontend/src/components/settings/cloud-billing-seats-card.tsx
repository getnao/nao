import { useState } from 'react';
import type { UserRole } from '@nao/shared/types';

import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-dialog';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type { TeamMember } from '@/components/settings/team/types';
import { CloudBillingSeatAdjustmentDialog } from '@/components/settings/cloud-billing-seat-adjustment-dialog';
import { TeamMembersList } from '@/components/settings/team/team-members-list';
import { Button } from '@/components/ui/button';
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
	pendingSeatQuantity,
	pendingSeatEffectiveAt,
	plan,
	currentPlanPrice,
	currentPromotionCodes,
	disabled,
	onAddSeats,
	onPreviewSeatChange,
	onConfirmSeatChange,
	onCancelPendingSeatChange,
	onSaveSeatSelection,
}: {
	tier: string;
	seatQuantity: number | null;
	seatLimit: number | null;
	availableSeats: number | null;
	candidates: CloudSeatCandidate[];
	pendingSeatQuantity?: number | null;
	pendingSeatEffectiveAt?: Date | null;
	plan?: CloudPlanOffer | null;
	currentPlanPrice?: string;
	currentPromotionCodes?: string[];
	disabled?: boolean;
	onAddSeats?: () => void;
	onPreviewSeatChange?: (quantity: number, promotionCode?: string) => Promise<CloudBillingChangePreview>;
	onConfirmSeatChange?: (token: string) => Promise<unknown>;
	onCancelPendingSeatChange?: () => Promise<unknown>;
	onSaveSeatSelection?: (selectedUserIds: string[]) => Promise<unknown>;
}) {
	const [adjustmentOpen, setAdjustmentOpen] = useState(false);
	const [accessError, setAccessError] = useState<string | null>(null);

	const seatedMembers = candidates.filter(({ isSeated }) => isSeated);
	const capacity = tier === 'team' ? seatQuantity : tier === 'free' ? (seatLimit ?? 3) : null;
	const accessByUserId = Object.fromEntries(
		candidates.map(({ userId, isSeated }) => [userId, isSeated ? 'seated' : 'read-only'] as const),
	);
	const accessDisabledByUserId = Object.fromEntries(
		candidates.map(({ userId, storedOrgRole }) => [userId, storedOrgRole === 'admin']),
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

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard
				title='Seat usage'
				description='Seats give people full access. Viewers and read-only members are always free.'
			>
				<div className='flex flex-wrap gap-x-10 gap-y-4'>
					<SeatStat label='Seats in use' value={seatedMembers.length} />
					<SeatStat label='Available seats' value={availableSeats ?? 'Unlimited'} />
					{capacity !== null && (
						<SeatStat label={tier === 'team' ? 'Purchased' : 'Included'} value={capacity} />
					)}
				</div>
				{capacity !== null && <SeatUsageBar used={seatedMembers.length} capacity={capacity} />}
				{seatsSummary && <p className='text-xs text-muted-foreground'>{seatsSummary}</p>}
				{tier === 'free' && onAddSeats && (
					<div className='flex flex-col items-start gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<p className='text-sm font-medium text-foreground'>Need more seats?</p>
							<p className='mt-1 text-xs text-muted-foreground'>
								Upgrade to Team and pay only for the full-access seats you need.
							</p>
						</div>
						<Button disabled={disabled} onClick={onAddSeats}>
							Add seats
						</Button>
					</div>
				)}
				{seatQuantity !== null && plan && onPreviewSeatChange && (
					<div className='flex flex-col items-start gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<p className='text-sm font-medium text-foreground'>Paid capacity</p>
							<p className='mt-1 text-xs text-muted-foreground'>
								Add seats now or schedule fewer seats for your next renewal.
							</p>
						</div>
						<Button variant='secondary' disabled={disabled} onClick={() => setAdjustmentOpen(true)}>
							Adjust seats
						</Button>
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
					accessChangesDisabled={disabled}
					accessSummary={capacity !== null ? `${seatedMembers.length}/${capacity}` : undefined}
					onAccessChange={
						onSaveSeatSelection ? (member, access) => void changeAccess(member, access) : undefined
					}
				/>
			</SettingsCard>

			{seatQuantity !== null && plan && onPreviewSeatChange && onConfirmSeatChange && (
				<CloudBillingSeatAdjustmentDialog
					open={adjustmentOpen}
					onOpenChange={setAdjustmentOpen}
					currentQuantity={seatQuantity}
					pendingQuantity={pendingSeatQuantity ?? null}
					pendingEffectiveAt={pendingSeatEffectiveAt ?? null}
					plan={plan}
					currentPlanPrice={currentPlanPrice}
					currentPromotionCodes={currentPromotionCodes}
					disabled={disabled}
					onPreview={onPreviewSeatChange}
					onConfirm={onConfirmSeatChange}
					onCancelPending={onCancelPendingSeatChange}
				/>
			)}
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
