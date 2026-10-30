import { useEffect, useState } from 'react';
import type { UserRole } from '@nao/shared/types';

import { CloudBillingChangeDialog } from '@/components/settings/cloud-billing-change-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';

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

export function CloudBillingSeatsCard({
	tier,
	seatQuantity,
	seatLimit,
	availableSeats,
	seatedMembers,
	disabled,
	onPreviewSeatChange,
	onConfirmSeatChange,
}: {
	tier: string;
	seatQuantity: number | null;
	seatLimit: number | null;
	availableSeats: number | null;
	seatedMembers: CloudSeatCandidate[];
	disabled?: boolean;
	onPreviewSeatChange?: (quantity: number) => Promise<BillingPreview>;
	onConfirmSeatChange?: (token: string) => Promise<unknown>;
}) {
	const [quantity, setQuantity] = useState(seatQuantity ?? 4);
	const [preview, setPreview] = useState<BillingPreview>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setQuantity(seatQuantity ?? 4), [seatQuantity]);

	const seatsSummary =
		tier === 'team'
			? `${seatQuantity ?? '—'} purchased seats`
			: tier === 'free'
				? `${seatLimit ?? 3} seats included`
				: tier === 'trial'
					? 'No seat limit during the trial'
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
		<SettingsCard
			title='Seats'
			description='Seats set how many people can have full access. Assign them from Organization Members.'
		>
			<div className='rounded-lg bg-muted/50 px-4 py-3'>
				<p className='text-xs text-muted-foreground'>Available seats</p>
				<p className='text-2xl font-semibold text-foreground'>{availableSeats ?? 'Unlimited'}</p>
				<p className='mt-1 text-xs text-muted-foreground'>{seatsSummary}</p>
			</div>
			<div>
				<p className='text-sm font-medium text-foreground'>Seated members</p>
				{seatedMembers.length > 0 ? (
					<ul className='mt-3 flex flex-col divide-y divide-border'>
						{seatedMembers.map((member) => (
							<li key={member.userId} className='min-w-0 py-3 first:pt-0 last:pb-0'>
								<div className='min-w-0'>
									<p className='truncate text-sm font-medium text-foreground'>{member.name}</p>
									<p className='truncate text-xs text-muted-foreground'>{member.email}</p>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p className='mt-2 text-sm text-muted-foreground'>No seated members.</p>
				)}
			</div>
			{tier === 'team' && onPreviewSeatChange && (
				<div className='mt-2 border-t border-border pt-5'>
					<p className='text-sm font-medium text-foreground'>Paid capacity</p>
					<p className='mt-1 text-xs text-muted-foreground'>
						Team starts at 4 seats. You will review the price before any billing change is applied.
					</p>
					<div className='mt-3 flex flex-col gap-3 sm:flex-row sm:items-end'>
						<label className='flex flex-col gap-1 text-sm font-medium'>
							Number of seats
							<Input
								type='number'
								min={4}
								value={quantity}
								onChange={(event) =>
									setQuantity(
										Number.isFinite(event.target.valueAsNumber)
											? Math.max(4, event.target.valueAsNumber)
											: 4,
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
				</div>
			)}
			{error && (
				<p className='mt-3 text-sm text-destructive' role='alert'>
					{error}
				</p>
			)}
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
		</SettingsCard>
	);
}
