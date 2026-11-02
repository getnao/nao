import { useEffect, useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-preview';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';

import { CloudBillingPlanTransition } from '@/components/settings/cloud-billing-plan-change-dialog';
import { CloudBillingPromotionCodeField } from '@/components/settings/cloud-billing-promotion-code-field';
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
import { formatBillingDate, formatBillingPrice } from '@/lib/billing-display';

export function CloudBillingSeatAdjustmentDialog({
	open,
	onOpenChange,
	currentQuantity,
	pendingQuantity,
	pendingEffectiveAt,
	plan,
	currentPlanPrice,
	currentPromotionCodes,
	disabled,
	onPreview,
	onConfirm,
	onCancelPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentQuantity: number;
	pendingQuantity: number | null;
	pendingEffectiveAt: Date | null;
	plan: CloudPlanOffer;
	currentPlanPrice?: string;
	currentPromotionCodes?: string[];
	disabled?: boolean;
	onPreview: (quantity: number, promotionCode?: string) => Promise<CloudBillingChangePreview>;
	onConfirm: (previewToken: string) => Promise<unknown>;
	onCancelPending?: () => Promise<unknown>;
}) {
	const [input, setInput] = useState('');
	const [promotionCode, setPromotionCode] = useState('');
	const [preview, setPreview] = useState<CloudBillingChangePreview>(null);
	const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
	const [reviewedPromotionCode, setReviewedPromotionCode] = useState('');
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setInput(String(pendingQuantity ?? currentQuantity));
			setPromotionCode('');
			setPreview(null);
			setReviewedQuantity(null);
			setReviewedPromotionCode('');
			setError(null);
		}
	}, [currentQuantity, open, pendingQuantity]);

	const typedQuantity = Number(input);
	const quantity =
		input !== '' &&
		Number.isInteger(typedQuantity) &&
		typedQuantity >= TEAM_MIN_SEATS &&
		typedQuantity <= TEAM_MAX_SEATS
			? typedQuantity
			: null;
	const unchangedQuantity = pendingQuantity ?? currentQuantity;
	const normalizedPromotionCode = promotionCode.trim();
	const inputsReviewed =
		preview !== null && reviewedQuantity === quantity && reviewedPromotionCode === normalizedPromotionCode;
	const expired = preview ? preview.expiresAt.getTime() <= Date.now() : false;
	const intervalLabel = plan.interval === 'monthly' ? 'month' : 'year';
	const currentPlan = {
		name: `Team · ${currentQuantity} seats`,
		price:
			currentPlanPrice ??
			`${formatBillingPrice(plan.unitAmount * currentQuantity, plan.currency)} / ${intervalLabel}`,
		promotionCodes: currentPromotionCodes,
	};
	const promotionApplied = Boolean(
		preview && inputsReviewed && reviewedPromotionCode && preview.promotionCodeDiscount,
	);
	const targetPrice =
		quantity === null
			? `${formatBillingPrice(plan.unitAmount, plan.currency)} / seat / ${intervalLabel}`
			: `${formatBillingPrice(plan.unitAmount * quantity, plan.currency)} / ${intervalLabel}`;
	const displayedTargetPrice =
		promotionApplied && preview?.promotionCodeDiscount
			? preview.promotionCodeDiscount.amount === 0
				? 'Free with promotion'
				: preview.promotionCodeDiscount.duration === 'once'
					? `${formatBillingPrice(preview.promotionCodeDiscount.amount, preview.currency)} first payment`
					: `${formatBillingPrice(preview.promotionCodeDiscount.amount, preview.currency)} / ${intervalLabel}`
			: targetPrice;
	const nextPlan = {
		name: quantity === null ? 'Team' : `Team · ${quantity} seats`,
		price: displayedTargetPrice,
		promotionCodes: promotionApplied ? [reviewedPromotionCode] : undefined,
	};

	const review = async () => {
		if (quantity === null) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			setPreview(
				normalizedPromotionCode
					? await onPreview(quantity, normalizedPromotionCode)
					: await onPreview(quantity),
			);
			setReviewedQuantity(quantity);
			setReviewedPromotionCode(normalizedPromotionCode);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to preview the seat change.');
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
			await onConfirm(preview.previewToken);
			onOpenChange(false);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : 'Unable to apply the seat change.';
			setError(message);
			if (message.toLowerCase().includes('preview')) {
				setPreview(null);
			}
		} finally {
			setIsPending(false);
		}
	};

	const cancelPending = async () => {
		if (!onCancelPending) {
			return;
		}
		setIsPending(true);
		setError(null);
		try {
			await onCancelPending();
			onOpenChange(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to cancel the scheduled seat change.');
		} finally {
			setIsPending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader className='pr-8'>
					<DialogTitle>Adjust seats</DialogTitle>
					<DialogDescription>
						Choose the total number of full-access Team seats. Viewers and read-only members remain free.
					</DialogDescription>
				</DialogHeader>
				<div className='space-y-4'>
					<CloudBillingPlanTransition currentPlan={currentPlan} nextPlan={nextPlan} />
					<div className='space-y-2'>
						<label htmlFor='paid-seat-quantity' className='text-sm font-medium'>
							Paid seats
						</label>
						<Input
							id='paid-seat-quantity'
							type='text'
							inputMode='numeric'
							autoComplete='off'
							value={input}
							disabled={disabled || isPending}
							aria-invalid={input !== '' && quantity === null}
							placeholder={`${TEAM_MIN_SEATS}–${TEAM_MAX_SEATS}`}
							onChange={(event) => {
								setInput(event.target.value.replace(/\D/g, '').slice(0, 2));
								setError(null);
							}}
						/>
					</div>
					<CloudBillingPromotionCodeField
						id='seat-promotion-code'
						value={promotionCode}
						applied={promotionApplied}
						disabled={disabled || isPending}
						applyDisabled={
							quantity === null ||
							quantity === unchangedQuantity ||
							normalizedPromotionCode === reviewedPromotionCode
						}
						onChange={(value) => {
							setPromotionCode(value);
							setError(null);
						}}
						onApply={() => void review()}
					/>
					{pendingQuantity !== null && pendingEffectiveAt && (
						<Callout>
							{pendingQuantity} seats are scheduled for {formatBillingDate(pendingEffectiveAt)}. Reviewing
							another reduction will replace this change.
						</Callout>
					)}
					{preview && inputsReviewed && (
						<p className='text-sm text-muted-foreground'>
							{preview.effective === 'immediate'
								? 'This change takes effect immediately.'
								: `This change takes effect on ${formatBillingDate(preview.effectiveAt)}.`}
						</p>
					)}
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
						<p className='text-sm text-destructive' role='alert'>
							{error}
						</p>
					)}
				</div>
				<DialogFooter className='sm:justify-between'>
					{pendingQuantity !== null && onCancelPending ? (
						<Button variant='ghost' disabled={disabled || isPending} onClick={() => void cancelPending()}>
							Cancel scheduled change
						</Button>
					) : (
						<span />
					)}
					<div className='flex flex-col-reverse gap-2 sm:flex-row'>
						<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						{inputsReviewed && !expired ? (
							<Button
								isLoading={isPending}
								disabled={disabled || isPending}
								onClick={() => void confirm()}
							>
								Confirm change
							</Button>
						) : (
							<Button
								isLoading={isPending}
								disabled={disabled || quantity === null || quantity === unchangedQuantity}
								onClick={() => void review()}
							>
								Review change
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
