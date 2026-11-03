import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type { CloudBillingChangeReview } from '@/hooks/use-cloud-billing-change-review';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { formatBillingPrice } from '@/lib/billing-display';

export type CloudBillingChangePreview = {
	amountDue: number;
	subtotal: number;
	tax: number;
	discount: number;
	currency: string;
	lines: Array<{
		description: string;
		amount: number;
		currency: string;
		proration: boolean;
		periodStartsAt: Date | null;
		periodEndsAt: Date | null;
	}>;
	previewToken: string;
	expiresAt: Date;
	effective: 'immediate' | 'period_end';
	effectiveAt: Date;
	firstChargeAt: Date | null;
	promotionCodeDiscount: {
		amount: number;
		duration: string;
	} | null;
	readOnlyUsersAfterChange: Array<{ userId: string; name: string; email: string }>;
} | null;

export function CloudBillingSeatQuantityField({
	id,
	review,
	disabled,
}: {
	id: string;
	review: CloudBillingChangeReview;
	disabled?: boolean;
}) {
	return (
		<div className='space-y-2'>
			<label htmlFor={id} className='text-sm font-medium'>
				Paid seats
			</label>
			<Input
				id={id}
				type='text'
				inputMode='numeric'
				autoComplete='off'
				placeholder={`${TEAM_MIN_SEATS}–${TEAM_MAX_SEATS}`}
				value={review.seatInput}
				disabled={disabled || review.isPending}
				aria-invalid={review.seatInput !== '' && review.seatQuantity === null}
				onChange={(event) => review.setSeatInput(event.target.value)}
			/>
		</div>
	);
}

export function CloudBillingChangeReviewNotices({ review }: { review: CloudBillingChangeReview }) {
	const readOnlyCount = review.reviewedPreview?.readOnlyUsersAfterChange.length ?? 0;
	return (
		<>
			{readOnlyCount > 0 && (
				<Callout variant='warning' className='text-xs'>
					{readOnlyCount} full-access {readOnlyCount === 1 ? 'user becomes' : 'users become'} read-only.
				</Callout>
			)}
			{review.expired && (
				<p className='text-sm text-amber-600' role='status'>
					This preview expired. Review the change again.
				</p>
			)}
		</>
	);
}

export function formatCloudBillingTargetPrice(
	plan: CloudPlanOffer,
	seatQuantity: number | null,
	appliedPromotion: CloudBillingChangeReview['appliedPromotion'],
): string {
	const intervalLabel = plan.interval === 'monthly' ? 'month' : 'year';
	if (appliedPromotion) {
		if (appliedPromotion.amount === 0) {
			return 'Free with promotion';
		}
		const amount = formatBillingPrice(appliedPromotion.amount, appliedPromotion.currency);
		return appliedPromotion.duration === 'once' ? `${amount} first payment` : `${amount} / ${intervalLabel}`;
	}
	if (plan.tier === 'team' && seatQuantity === null) {
		return `${formatBillingPrice(plan.unitAmount, plan.currency)} / seat / ${intervalLabel}`;
	}
	return `${formatBillingPrice(plan.unitAmount * (seatQuantity ?? 1), plan.currency)} / ${intervalLabel}`;
}
