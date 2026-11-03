import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-preview';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import {
	CloudBillingChangeReviewNotices,
	CloudBillingSeatQuantityField,
	formatCloudBillingTargetPrice,
} from '@/components/settings/cloud-billing-change-preview';

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
import { useCloudBillingChangeReview } from '@/hooks/use-cloud-billing-change-review';
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
	const unchangedQuantity = pendingQuantity ?? currentQuantity;
	const review = useCloudBillingChangeReview({
		open,
		resetKey: `${currentQuantity}:${pendingQuantity}`,
		initialSeatInput: String(unchangedQuantity),
		requiresSeats: true,
		errorMessages: {
			preview: 'Unable to preview the seat change.',
			confirm: 'Unable to apply the seat change.',
		},
		onPreview: (quantity, promotionCode) => {
			if (quantity === null) {
				return Promise.resolve(null);
			}
			return promotionCode ? onPreview(quantity, promotionCode) : onPreview(quantity);
		},
		onConfirm: (preview) => onConfirm(preview.previewToken),
		onDone: () => onOpenChange(false),
	});
	const { seatQuantity: quantity, appliedPromotion, reviewedPreview, isPending, error } = review;
	const reviewDisabled = quantity === null || quantity === unchangedQuantity;
	const intervalLabel = plan.interval === 'monthly' ? 'month' : 'year';
	const currentPlan = {
		name: `Team · ${currentQuantity} seats`,
		price:
			currentPlanPrice ??
			`${formatBillingPrice(plan.unitAmount * currentQuantity, plan.currency)} / ${intervalLabel}`,
		promotionCodes: currentPromotionCodes,
	};
	const nextPlan = {
		name: quantity === null ? 'Team' : `Team · ${quantity} seats`,
		price: formatCloudBillingTargetPrice(plan, quantity, appliedPromotion),
		promotionCodes: appliedPromotion ? [appliedPromotion.code] : undefined,
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
					<CloudBillingSeatQuantityField id='paid-seat-quantity' review={review} disabled={disabled} />
					<CloudBillingPromotionCodeField
						id='seat-promotion-code'
						value={review.promotionCode}
						applied={appliedPromotion !== null}
						disabled={disabled || isPending}
						applyDisabled={reviewDisabled || !review.promotionCodeChanged}
						onChange={review.setPromotionCode}
						onApply={() => void review.review()}
					/>
					{pendingQuantity !== null && pendingEffectiveAt && (
						<Callout>
							{pendingQuantity} seats are scheduled for {formatBillingDate(pendingEffectiveAt)}. Reviewing
							another reduction will replace this change.
						</Callout>
					)}
					{reviewedPreview && (
						<p className='text-sm text-muted-foreground'>
							{reviewedPreview.effective === 'immediate'
								? 'This change takes effect immediately.'
								: `This change takes effect on ${formatBillingDate(reviewedPreview.effectiveAt)}.`}
						</p>
					)}
					<CloudBillingChangeReviewNotices review={review} />
					{error && (
						<p className='text-sm text-destructive' role='alert'>
							{error}
						</p>
					)}
				</div>
				<DialogFooter className='sm:justify-between'>
					{pendingQuantity !== null && onCancelPending ? (
						<Button
							variant='ghost'
							disabled={disabled || isPending}
							onClick={() =>
								void review.runAndClose(onCancelPending, 'Unable to cancel the scheduled seat change.')
							}
						>
							Cancel scheduled change
						</Button>
					) : (
						<span />
					)}
					<div className='flex flex-col-reverse gap-2 sm:flex-row'>
						<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						{review.canConfirm ? (
							<Button
								isLoading={isPending}
								disabled={disabled || isPending}
								onClick={() => void review.confirm()}
							>
								Confirm change
							</Button>
						) : (
							<Button
								isLoading={isPending}
								disabled={disabled || reviewDisabled}
								onClick={() => void review.review()}
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
