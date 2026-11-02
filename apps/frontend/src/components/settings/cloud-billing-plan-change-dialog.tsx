import { useEffect, useState } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-dialog';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import { CloudBillingPromotionCodeField } from '@/components/settings/cloud-billing-promotion-code-field';
import { Badge } from '@/components/ui/badge';
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

export function CloudBillingPlanChangeDialog({
	open,
	onOpenChange,
	plan,
	currentPlan,
	disabled,
	onPreview,
	onConfirm,
	onFixPayment,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	plan: CloudPlanOffer | null;
	currentPlan: { badge?: string; name: string; price?: string; promotionCodes?: string[] } | null;
	disabled?: boolean;
	onPreview: (seatQuantity?: number, promotionCode?: string) => Promise<CloudBillingChangePreview>;
	onConfirm: (preview: NonNullable<CloudBillingChangePreview>) => Promise<unknown>;
	onFixPayment?: () => void;
}) {
	const [seatInput, setSeatInput] = useState('');
	const [promotionCode, setPromotionCode] = useState('');
	const [preview, setPreview] = useState<CloudBillingChangePreview>(null);
	const [reviewedSeats, setReviewedSeats] = useState<number | null>(null);
	const [reviewedPromotionCode, setReviewedPromotionCode] = useState('');
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setSeatInput('');
			setPromotionCode('');
			setPreview(null);
			setReviewedSeats(null);
			setReviewedPromotionCode('');
			setError(null);
		}
	}, [open, plan?.planKey]);

	if (!plan) {
		return null;
	}

	const typedSeatQuantity = Number(seatInput);
	const seatQuantity =
		plan.tier === 'team' &&
		seatInput !== '' &&
		Number.isInteger(typedSeatQuantity) &&
		typedSeatQuantity >= TEAM_MIN_SEATS &&
		typedSeatQuantity <= TEAM_MAX_SEATS
			? typedSeatQuantity
			: null;
	const normalizedPromotionCode = promotionCode.trim();
	const inputsReviewed =
		preview !== null && reviewedSeats === seatQuantity && reviewedPromotionCode === normalizedPromotionCode;
	const expired = preview ? preview.expiresAt.getTime() <= Date.now() : false;
	const intervalLabel = plan.interval === 'monthly' ? 'month' : 'year';
	const targetPlanName =
		plan.tier === 'team' ? (seatQuantity ? `Team · ${seatQuantity} seats` : 'Team') : 'Unlimited';
	const targetPrice =
		plan.tier === 'team' && seatQuantity === null
			? `${formatBillingPrice(plan.unitAmount, plan.currency)} / seat / ${intervalLabel}`
			: `${formatBillingPrice(plan.unitAmount * (seatQuantity ?? 1), plan.currency)} / ${intervalLabel}`;
	const promotionApplied = Boolean(
		preview && inputsReviewed && reviewedPromotionCode && preview.promotionCodeDiscount,
	);
	const displayedTargetPrice =
		promotionApplied && preview?.promotionCodeDiscount
			? preview.promotionCodeDiscount.amount === 0
				? 'Free with promotion'
				: preview.promotionCodeDiscount.duration === 'once'
					? `${formatBillingPrice(preview.promotionCodeDiscount.amount, preview.currency)} first payment`
					: `${formatBillingPrice(preview.promotionCodeDiscount.amount, preview.currency)} / ${intervalLabel}`
			: targetPrice;

	const review = async () => {
		if (plan.tier === 'team' && seatQuantity === null) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			const nextPreview = await onPreview(seatQuantity ?? undefined, normalizedPromotionCode || undefined);
			setPreview(nextPreview);
			setReviewedSeats(seatQuantity);
			setReviewedPromotionCode(normalizedPromotionCode);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to preview this plan change.');
		} finally {
			setIsPending(false);
		}
	};

	const confirm = async () => {
		if (!preview || !inputsReviewed || expired) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			await onConfirm(preview);
			onOpenChange(false);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : 'Unable to apply this plan change.';
			setError(message);
			if (message.toLowerCase().includes('preview')) {
				setPreview(null);
			}
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-h-[calc(100vh-2rem)] overflow-y-auto'>
				<DialogHeader className='pr-8'>
					<DialogTitle>Change to {plan.tier === 'team' ? 'Team' : 'Unlimited'}</DialogTitle>
					<DialogDescription>
						Choose your plan options, then review Stripe&apos;s final totals.
					</DialogDescription>
				</DialogHeader>

				<div className='space-y-4'>
					<CloudBillingPlanTransition
						currentPlan={{
							badge: currentPlan?.badge,
							name: currentPlan?.name ?? 'Current plan',
							price: currentPlan?.price,
							promotionCodes: currentPlan?.promotionCodes,
						}}
						nextPlan={{
							name: targetPlanName,
							price: displayedTargetPrice,
							promotionCodes: promotionApplied ? [reviewedPromotionCode] : undefined,
						}}
					/>

					{plan.tier === 'team' && (
						<div className='space-y-2'>
							<label htmlFor='plan-seat-quantity' className='text-sm font-medium'>
								Paid seats
							</label>
							<Input
								id='plan-seat-quantity'
								type='text'
								inputMode='numeric'
								autoComplete='off'
								placeholder={`${TEAM_MIN_SEATS}–${TEAM_MAX_SEATS}`}
								value={seatInput}
								disabled={disabled || isPending}
								aria-invalid={seatInput !== '' && seatQuantity === null}
								onChange={(event) => {
									setSeatInput(event.target.value.replace(/\D/g, '').slice(0, 2));
									setError(null);
								}}
							/>
						</div>
					)}

					<CloudBillingPromotionCodeField
						id='plan-promotion-code'
						value={promotionCode}
						applied={promotionApplied}
						disabled={disabled || isPending}
						applyDisabled={
							(plan.tier === 'team' && seatQuantity === null) ||
							normalizedPromotionCode === reviewedPromotionCode
						}
						onChange={(value) => {
							setPromotionCode(value);
							setError(null);
						}}
						onApply={() => void review()}
					/>

					{preview && inputsReviewed && preview.readOnlyUsersAfterChange.length > 0 && (
						<Callout variant='warning' className='text-xs'>
							{preview.readOnlyUsersAfterChange.length} full-access{' '}
							{preview.readOnlyUsersAfterChange.length === 1 ? 'user becomes' : 'users become'} read-only.
						</Callout>
					)}

					{expired && inputsReviewed && (
						<p className='text-sm text-amber-600' role='status'>
							This preview expired. Review the change again.
						</p>
					)}

					{error && (
						<div className='space-y-2' role='alert'>
							<p className='text-sm text-destructive'>{error}</p>
							{onFixPayment && /payment|authentication/i.test(error) && (
								<Button variant='secondary' size='sm' onClick={onFixPayment}>
									Fix payment method in Stripe
								</Button>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{inputsReviewed && !expired ? (
						<Button isLoading={isPending} disabled={disabled || isPending} onClick={() => void confirm()}>
							Confirm change
						</Button>
					) : (
						<Button
							isLoading={isPending}
							disabled={disabled || (plan.tier === 'team' && seatQuantity === null)}
							onClick={() => void review()}
						>
							Review change
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function CloudBillingPlanTransition({
	currentPlan,
	nextPlan,
}: {
	currentPlan: { badge?: string; name: string; price?: string; promotionCodes?: string[] };
	nextPlan: { name: string; price?: string; promotionCodes?: string[] };
}) {
	return (
		<div className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border p-3'>
			<PlanSummary
				badge={currentPlan.badge ?? 'Current'}
				name={currentPlan.name}
				price={currentPlan.price}
				promotionCodes={currentPlan.promotionCodes}
			/>
			<ArrowRightIcon className='size-4 text-muted-foreground' aria-hidden='true' />
			<PlanSummary
				badge='New plan'
				name={nextPlan.name}
				price={nextPlan.price}
				promotionCodes={nextPlan.promotionCodes}
			/>
		</div>
	);
}

function PlanSummary({
	badge,
	name,
	price,
	promotionCodes,
}: {
	badge: string;
	name: string;
	price?: string;
	promotionCodes?: string[];
}) {
	return (
		<div className='min-w-0'>
			<Badge variant='secondary' className='text-[10px]'>
				{badge}
			</Badge>
			<p className='mt-1.5 truncate text-sm font-semibold text-foreground'>{name}</p>
			{(price || promotionCodes?.length) && (
				<div className='mt-0.5 flex flex-wrap items-center gap-1.5'>
					{price && <p className='text-xs text-muted-foreground'>{price}</p>}
					{promotionCodes?.map((code) => (
						<Badge key={code} variant='outline' className='text-[10px]'>
							{code}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}
