import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plans';
import type { CloudBillingChangePreview } from '@/hooks/use-organization-billing';
import { formatCloudPlanPrice, getCloudPlanName } from '@/components/settings/cloud-billing-plans';
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
import { formatBillingDate, formatBillingPrice } from '@/lib/billing-display';

export type CloudBillingChangeDialogPreview = Omit<CloudBillingChangePreview, 'promotionCodeDiscount'> &
	Partial<Pick<CloudBillingChangePreview, 'promotionCodeDiscount'>>;

type PlanSummary = { badge: string; name: string; price?: string };

/**
 * Without `onCheckout`, the admin reviews Stripe's totals before confirming, and confirmation is only
 * offered for a preview that matches the current inputs and whose token has not expired.
 */
export function CloudBillingChangeDialog({
	open,
	onOpenChange,
	title,
	description,
	plan,
	current,
	initialSeats = null,
	fixedSeats = false,
	allowPromotionCode = true,
	seatUserCount,
	onCheckout,
	onPreview,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	plan: CloudPlanOffer | null;
	current?: PlanSummary | null;
	initialSeats?: number | null;
	fixedSeats?: boolean;
	allowPromotionCode?: boolean;
	seatUserCount: number;
	onCheckout?: (seats?: number) => Promise<unknown>;
	onPreview?: (seats?: number, promotionCode?: string) => Promise<CloudBillingChangeDialogPreview>;
	onConfirm?: (previewToken: string) => Promise<unknown>;
}) {
	const [seatInput, setSeatInput] = useState('');
	const [promotionCode, setPromotionCode] = useState('');
	const [preview, setPreview] = useState<CloudBillingChangeDialogPreview | null>(null);
	const [reviewedInputs, setReviewedInputs] = useState('');
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setSeatInput(initialSeats === null ? '' : String(initialSeats));
			setPromotionCode('');
			setPreview(null);
			setError(null);
		}
	}, [open, initialSeats, plan?.key]);

	if (!plan) {
		return null;
	}

	const choosesSeats = plan.tier === 'team' && !fixedSeats;
	const seats = choosesSeats ? parseTeamSeats(seatInput) : (initialSeats ?? undefined);
	const missingSeats = choosesSeats && seats === undefined;
	const normalizedPromotionCode = promotionCode.trim();
	const inputs = `${seats ?? ''}:${normalizedPromotionCode}`;
	const reviewedPreview = preview && reviewedInputs === inputs ? preview : null;
	const expired = reviewedPreview !== null && reviewedPreview.expiresAt.getTime() <= Date.now();
	const promotion = reviewedPreview?.promotionCodeDiscount && normalizedPromotionCode ? reviewedPreview : null;
	const readOnlyCount = onCheckout
		? Math.max(0, seatUserCount - (seats ?? seatUserCount))
		: (reviewedPreview?.readOnlyUsersAfterChange.length ?? 0);

	const run = async (action: () => Promise<unknown>, failureMessage: string) => {
		setIsPending(true);
		setError(null);
		try {
			await action();
			return true;
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : failureMessage);
			return false;
		} finally {
			setIsPending(false);
		}
	};
	const review = () =>
		run(async () => {
			setPreview(await onPreview!(seats, normalizedPromotionCode || undefined));
			setReviewedInputs(inputs);
		}, 'Unable to preview this change.');
	const submit = async () => {
		const action = onCheckout ? () => onCheckout(seats) : () => onConfirm!(reviewedPreview!.previewToken);
		if (await run(action, 'Unable to apply this change.')) {
			onOpenChange(false);
		} else if (!onCheckout) {
			setPreview(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='max-h-[calc(100vh-2rem)] overflow-y-auto'>
				<DialogHeader className='pr-8'>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div className='space-y-4'>
					{current && (
						<div className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border p-3'>
							<PlanSummaryColumn plan={current} />
							<ArrowRightIcon className='size-4 text-muted-foreground' aria-hidden='true' />
							<PlanSummaryColumn
								plan={{
									badge: 'New plan',
									name: getCloudPlanName(plan.tier, seats ?? null),
									price: promotion
										? formatPromotionPrice(promotion, plan)
										: formatCloudPlanPrice(plan, seats ?? null),
								}}
								promotionCode={promotion ? normalizedPromotionCode : undefined}
							/>
						</div>
					)}

					{choosesSeats && (
						<div className='rounded-xl border border-border'>
							<div className='flex items-center justify-between gap-4 p-4'>
								<div className='min-w-0'>
									<label
										htmlFor='cloud-billing-seats'
										className='block text-sm font-medium text-foreground'
									>
										Paid seats
									</label>
									<p className='mt-0.5 text-xs text-muted-foreground'>
										{TEAM_MIN_SEATS}–{TEAM_MAX_SEATS} seats · {formatCloudPlanPrice(plan, null)}
									</p>
								</div>
								<Input
									id='cloud-billing-seats'
									type='text'
									inputMode='numeric'
									autoComplete='off'
									placeholder={String(TEAM_MIN_SEATS)}
									value={seatInput}
									disabled={isPending}
									aria-invalid={seatInput !== '' && missingSeats}
									className='w-20 shrink-0 text-center'
									onChange={(event) => {
										setSeatInput(event.target.value.replace(/\D/g, '').slice(0, 2));
										setError(null);
									}}
								/>
							</div>
							{onCheckout && (
								<div className='flex items-baseline justify-between gap-4 border-t border-border px-4 py-3 text-sm'>
									<span className='text-muted-foreground'>Total</span>
									<span className='font-semibold text-foreground'>
										{seats === undefined ? '—' : formatCloudPlanPrice(plan, seats)}
									</span>
								</div>
							)}
						</div>
					)}

					{!onCheckout && allowPromotionCode && (
						<div className='space-y-1.5 border-t border-border pt-3'>
							<label
								htmlFor='cloud-billing-promotion-code'
								className='text-xs font-medium text-muted-foreground'
							>
								Promotion code <span className='font-normal'>(optional)</span>
							</label>
							<div className='flex flex-col gap-2 sm:flex-row'>
								<Input
									id='cloud-billing-promotion-code'
									autoComplete='off'
									maxLength={200}
									placeholder='Optional'
									value={promotionCode}
									disabled={isPending}
									className='h-8 text-sm'
									onChange={(event) => {
										setPromotionCode(event.target.value);
										setError(null);
									}}
								/>
								{promotion ? (
									<div
										className='flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-emerald-600'
										role='status'
									>
										<CheckIcon className='size-3.5' aria-hidden='true' />
										Valid
									</div>
								) : (
									<Button
										variant='secondary'
										size='sm'
										disabled={isPending || missingSeats || !normalizedPromotionCode}
										onClick={() => void review()}
									>
										Apply code
									</Button>
								)}
							</div>
							<p className='text-xs text-muted-foreground'>A new code replaces the current discount.</p>
						</div>
					)}

					{reviewedPreview && <ChargeSummary preview={reviewedPreview} />}
					{readOnlyCount > 0 && (
						<Callout variant='warning' className='text-xs'>
							{readOnlyCount} {readOnlyCount === 1 ? 'person' : 'people'} with full access will become
							read-only. Their memberships and data are kept.
						</Callout>
					)}
					{expired && (
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

				<DialogFooter>
					<Button variant='secondary' disabled={isPending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{onCheckout || (reviewedPreview && !expired) ? (
						<Button isLoading={isPending} disabled={missingSeats} onClick={() => void submit()}>
							{onCheckout ? 'Continue to Stripe' : 'Confirm change'}
						</Button>
					) : (
						<Button isLoading={isPending} disabled={missingSeats} onClick={() => void review()}>
							Review change
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function PlanSummaryColumn({ plan, promotionCode }: { plan: PlanSummary; promotionCode?: string }) {
	return (
		<div className='min-w-0'>
			<Badge variant='secondary' className='text-[10px]'>
				{plan.badge}
			</Badge>
			<p className='mt-1.5 truncate text-sm font-semibold text-foreground'>{plan.name}</p>
			<div className='mt-0.5 flex flex-wrap items-center gap-1.5'>
				{plan.price && <p className='text-xs text-muted-foreground'>{plan.price}</p>}
				{promotionCode && (
					<Badge variant='outline' className='text-[10px]'>
						{promotionCode}
					</Badge>
				)}
			</div>
		</div>
	);
}

function ChargeSummary({ preview }: { preview: CloudBillingChangeDialogPreview }) {
	const chargedAt = preview.firstChargeAt ?? (preview.effective === 'immediate' ? null : preview.effectiveAt);
	return (
		<div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-border p-3'>
			<p className='text-sm font-medium text-foreground'>
				{chargedAt ? `Total charged on ${formatBillingDate(chargedAt)}` : 'Total charged now'}
			</p>
			<div className='text-right'>
				<p className='text-sm font-semibold text-foreground'>
					{formatBillingPrice(preview.amountDue, preview.currency)}
				</p>
				{preview.tax > 0 && (
					<p className='text-xs text-muted-foreground'>
						Includes {formatBillingPrice(preview.tax, preview.currency)} tax
					</p>
				)}
			</div>
		</div>
	);
}

function formatPromotionPrice(preview: CloudBillingChangeDialogPreview, plan: CloudPlanOffer) {
	const discount = preview.promotionCodeDiscount!;
	if (discount.amount === 0) {
		return 'Free with promotion';
	}
	const amount = formatBillingPrice(discount.amount, preview.currency);
	return discount.duration === 'once'
		? `${amount} first payment`
		: `${amount} / ${plan.interval === 'monthly' ? 'month' : 'year'}`;
}

function parseTeamSeats(input: string): number | undefined {
	const seats = Number(input);
	return input !== '' && Number.isInteger(seats) && seats >= TEAM_MIN_SEATS && seats <= TEAM_MAX_SEATS
		? seats
		: undefined;
}
