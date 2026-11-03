import { ArrowRightIcon } from 'lucide-react';

import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-preview';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import {
	CloudBillingChangeReviewNotices,
	CloudBillingSeatQuantityField,
	formatCloudBillingTargetPrice,
} from '@/components/settings/cloud-billing-change-preview';
import { CloudBillingPromotionCodeField } from '@/components/settings/cloud-billing-promotion-code-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { useCloudBillingChangeReview } from '@/hooks/use-cloud-billing-change-review';

export function CloudBillingPlanChangeDialog({
	open,
	onOpenChange,
	plan,
	currentPlan,
	disabled,
	onPreview,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	plan: CloudPlanOffer | null;
	currentPlan: { badge?: string; name: string; price?: string; promotionCodes?: string[] } | null;
	disabled?: boolean;
	onPreview: (seatQuantity?: number, promotionCode?: string) => Promise<CloudBillingChangePreview>;
	onConfirm: (preview: NonNullable<CloudBillingChangePreview>) => Promise<unknown>;
}) {
	const review = useCloudBillingChangeReview({
		open,
		resetKey: plan?.planKey ?? '',
		requiresSeats: plan?.tier === 'team',
		errorMessages: {
			preview: 'Unable to preview this plan change.',
			confirm: 'Unable to apply this plan change.',
		},
		onPreview: (seatQuantity, promotionCode) => onPreview(seatQuantity ?? undefined, promotionCode),
		onConfirm,
		onDone: () => onOpenChange(false),
	});

	if (!plan) {
		return null;
	}

	const { seatQuantity, appliedPromotion, isPending, error } = review;
	const missingSeats = plan.tier === 'team' && seatQuantity === null;
	const targetPlanName =
		plan.tier === 'team' ? (seatQuantity ? `Team · ${seatQuantity} seats` : 'Team') : 'Unlimited';

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
							price: formatCloudBillingTargetPrice(plan, seatQuantity, appliedPromotion),
							promotionCodes: appliedPromotion ? [appliedPromotion.code] : undefined,
						}}
					/>

					{plan.tier === 'team' && (
						<CloudBillingSeatQuantityField id='plan-seat-quantity' review={review} disabled={disabled} />
					)}

					<CloudBillingPromotionCodeField
						id='plan-promotion-code'
						value={review.promotionCode}
						applied={appliedPromotion !== null}
						disabled={disabled || isPending}
						applyDisabled={missingSeats || !review.promotionCodeChanged}
						onChange={review.setPromotionCode}
						onApply={() => void review.review()}
					/>

					<CloudBillingChangeReviewNotices review={review} />

					{error && (
						<p className='text-sm text-destructive' role='alert'>
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
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
							disabled={disabled || missingSeats}
							onClick={() => void review.review()}
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
