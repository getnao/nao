import { useEffect, useState } from 'react';

import type { CloudSeatCandidate } from '@/components/settings/cloud-billing-seats-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { formatBillingDate } from '@/lib/billing-display';

export function CloudBillingSwitchToFreeDialog({
	open,
	onOpenChange,
	effectiveAt,
	candidates,
	trialing = false,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	effectiveAt: Date | null;
	candidates: CloudSeatCandidate[];
	trialing?: boolean;
	onConfirm: (selectedUserIds: string[]) => Promise<unknown>;
}) {
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);
	const automaticAdmins = candidates.filter((candidate) => candidate.storedOrgRole === 'admin').slice(0, 3);
	const selectableLimit = Math.max(0, 3 - automaticAdmins.length);

	useEffect(() => {
		if (open) {
			const selectableCandidates = candidates.filter((candidate) => candidate.storedOrgRole !== 'admin');
			const preferredIds = selectableCandidates
				.filter((candidate) => candidate.isSelected)
				.map((candidate) => candidate.userId);
			const seatedIds = selectableCandidates
				.filter((candidate) => candidate.isSeated)
				.map((candidate) => candidate.userId);
			setSelectedIds([...new Set([...preferredIds, ...seatedIds])].slice(0, selectableLimit));
			setError(null);
		}
	}, [candidates, open, selectableLimit]);

	const selectedCandidates = candidates.filter(
		(candidate) =>
			automaticAdmins.some((admin) => admin.userId === candidate.userId) ||
			selectedIds.includes(candidate.userId),
	);
	const readOnlyCandidates = candidates.filter(
		(candidate) => !selectedCandidates.some((selected) => selected.userId === candidate.userId),
	);

	const confirm = async () => {
		setIsPending(true);
		setError(null);
		try {
			await onConfirm(selectedIds);
			onOpenChange(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to switch to Free.');
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-h-[calc(100vh-2rem)] overflow-y-auto'>
				<DialogHeader>
					<DialogTitle>{trialing ? 'Use Free after trial' : 'Switch to Free'}</DialogTitle>
					<DialogDescription>
						{trialing
							? `Your trial remains active through ${formatBillingDate(effectiveAt)}. Free capacity applies afterward.`
							: `Your current plan and capacity remain active through ${formatBillingDate(effectiveAt)}. There is no refund.`}
					</DialogDescription>
				</DialogHeader>
				<div className='space-y-2'>
					<p className='text-sm font-medium'>Choose who keeps full access</p>
					{candidates.map((candidate) => {
						const admin = automaticAdmins.some((item) => item.userId === candidate.userId);
						const checked = admin || selectedIds.includes(candidate.userId);
						return (
							<label
								key={candidate.userId}
								className='flex items-center gap-3 rounded-lg border p-3 text-sm'
							>
								<Checkbox
									checked={checked}
									disabled={admin || (!checked && selectedIds.length >= selectableLimit) || isPending}
									aria-label={`Keep ${candidate.name} seated on Free`}
									onCheckedChange={(nextChecked) =>
										setSelectedIds((current) =>
											nextChecked
												? [...new Set([...current, candidate.userId])]
												: current.filter((id) => id !== candidate.userId),
										)
									}
								/>
								<span>{candidate.name}</span>
								{admin && <span className='text-xs text-muted-foreground'>Organization admin</span>}
							</label>
						);
					})}
				</div>
				{readOnlyCandidates.length > 0 && (
					<p className='text-sm text-muted-foreground'>
						{readOnlyCandidates.map((candidate) => candidate.name).join(', ')} will have read-only access.
						No memberships or data will be removed.
					</p>
				)}
				{error && (
					<p className='text-sm text-destructive' role='alert'>
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
						{trialing ? 'Keep paid plan after trial' : 'Keep current plan'}
					</Button>
					<Button isLoading={isPending} onClick={() => void confirm()}>
						{trialing ? 'Confirm Free after trial' : 'Confirm Switch to Free'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
