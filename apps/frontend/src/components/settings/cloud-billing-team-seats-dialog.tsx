import { useEffect, useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatBillingPrice } from '@/lib/billing-display';

export function CloudBillingTeamSeatsDialog({
	open,
	onOpenChange,
	plan,
	seatUserCount,
	trialing,
	redirectsToCheckout,
	disabled,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	plan: CloudPlanOffer | null;
	seatUserCount: number;
	trialing: boolean;
	redirectsToCheckout: boolean;
	disabled?: boolean;
	onConfirm: (plan: CloudPlanOffer, seatQuantity: number) => Promise<unknown>;
}) {
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);

	useEffect(() => {
		if (open) {
			setInput('');
			setError(null);
		}
	}, [open]);

	if (!plan) {
		return null;
	}

	const typedQuantity = Number(input);
	const quantity =
		input !== '' && typedQuantity >= TEAM_MIN_SEATS && typedQuantity <= TEAM_MAX_SEATS ? typedQuantity : null;
	const intervalLabel = plan.interval === 'monthly' ? 'month' : 'year';
	const readOnlyCount = quantity === null ? 0 : Math.max(0, seatUserCount - quantity);
	const clampInput = () => {
		if (input !== '' && quantity === null) {
			setInput(String(Math.min(TEAM_MAX_SEATS, Math.max(TEAM_MIN_SEATS, typedQuantity))));
		}
	};
	const confirm = async () => {
		if (quantity === null) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			await onConfirm(plan, quantity);
			onOpenChange(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to choose Team.');
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader className='pr-8'>
					<DialogTitle>Choose Team seats</DialogTitle>
					<DialogDescription>
						Choose how many full-access seats to pay for. Viewers remain free.
					</DialogDescription>
				</DialogHeader>
				<div className='rounded-xl border border-border'>
					<div className='flex items-center justify-between gap-4 p-4'>
						<div className='min-w-0'>
							<label htmlFor='team-seat-quantity' className='block text-sm font-medium text-foreground'>
								Paid seats
							</label>
							<p className='mt-0.5 text-xs text-muted-foreground'>
								{TEAM_MIN_SEATS}–{TEAM_MAX_SEATS} seats ·{' '}
								{formatBillingPrice(plan.unitAmount, plan.currency)} per seat / {intervalLabel}
							</p>
						</div>
						<Input
							id='team-seat-quantity'
							type='text'
							inputMode='numeric'
							autoComplete='off'
							placeholder={String(TEAM_MIN_SEATS)}
							value={input}
							disabled={disabled || isPending}
							aria-invalid={input !== '' && quantity === null}
							className='w-20 shrink-0 text-center'
							onChange={(event) => setInput(event.target.value.replace(/\D/g, '').slice(0, 2))}
							onBlur={clampInput}
						/>
					</div>
					<div className='flex items-baseline justify-between gap-4 border-t border-border px-4 py-3 text-sm'>
						<span className='text-muted-foreground'>Total</span>
						<span className='font-semibold text-foreground'>
							{quantity === null
								? '—'
								: `${formatBillingPrice(plan.unitAmount * quantity, plan.currency)} / ${intervalLabel}`}
						</span>
					</div>
				</div>
				{readOnlyCount > 0 && (
					<Callout variant='warning' className='text-xs'>
						{readOnlyCount} full-access {readOnlyCount === 1 ? 'user becomes' : 'users become'} read-only
						when {trialing ? 'the trial ends' : 'Team starts'}.
					</Callout>
				)}
				{error && (
					<p className='text-sm text-destructive' role='alert'>
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						isLoading={isPending}
						disabled={disabled || quantity === null}
						onClick={() => void confirm()}
					>
						{redirectsToCheckout ? 'Continue to Stripe' : 'Review change'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
