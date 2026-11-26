import { useEffect, useState } from 'react';

import type { CloudBillingStatus } from '@/hooks/use-organization-billing';
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
	data,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	data: CloudBillingStatus;
	onConfirm: (selectedUserIds?: string[]) => Promise<unknown>;
}) {
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);
	const trialing = data.tier === 'trial';
	const effectiveAt = trialing ? data.trialEndsAt : data.currentPeriodEndsAt;
	const adminIds = data.members
		.filter((member) => member.membershipClass === 'org_admin')
		.slice(0, data.policy.freeSeatLimit)
		.map((member) => member.id);
	const selectableLimit = Math.max(0, data.policy.freeSeatLimit - adminIds.length);

	useEffect(() => {
		if (open) {
			const preferredIds = [
				...(data.pendingFreeSeatUserIds ?? []),
				...data.members.filter((member) => member.seated).map((member) => member.id),
			].filter((id) => data.members.some((member) => member.id === id && member.membershipClass !== 'org_admin'));
			setSelectedIds([...new Set(preferredIds)].slice(0, selectableLimit));
			setError(null);
		}
	}, [data.members, data.pendingFreeSeatUserIds, open, selectableLimit]);

	const readOnlyNames = data.members
		.filter((member) => !adminIds.includes(member.id) && !selectedIds.includes(member.id))
		.map((member) => member.name);

	const confirm = async () => {
		setIsPending(true);
		setError(null);
		try {
			await onConfirm(trialing ? undefined : selectedIds);
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
				{!trialing && (
					<>
						<div className='space-y-2'>
							<p className='text-sm font-medium'>Choose who keeps full access</p>
							{data.members.map((member) => {
								const admin = adminIds.includes(member.id);
								const checked = admin || selectedIds.includes(member.id);
								return (
									<label
										key={member.id}
										className='flex items-center gap-3 rounded-lg border p-3 text-sm'
									>
										<Checkbox
											checked={checked}
											disabled={
												admin ||
												(!checked && selectedIds.length >= selectableLimit) ||
												isPending
											}
											aria-label={`Keep ${member.name} seated on Free`}
											onCheckedChange={(nextChecked) => {
												setSelectedIds((current) =>
													nextChecked
														? [...new Set([...current, member.id])]
														: current.filter((id) => id !== member.id),
												);
											}}
										/>
										<span>{member.name}</span>
										{admin && (
											<span className='text-xs text-muted-foreground'>Organization admin</span>
										)}
									</label>
								);
							})}
						</div>
						{readOnlyNames.length > 0 && (
							<p className='text-sm text-muted-foreground'>
								{readOnlyNames.join(', ')} will have read-only access. No memberships or data will be
								removed.
							</p>
						)}
					</>
				)}
				{error && (
					<p className='text-sm text-destructive' role='alert'>
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
						{trialing ? 'Cancel' : 'Keep current plan'}
					</Button>
					<Button isLoading={isPending} onClick={() => void confirm()}>
						{trialing ? 'Confirm Free after trial' : 'Confirm switch to Free'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
