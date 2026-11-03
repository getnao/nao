import { ArrowRightIcon } from 'lucide-react';
import { FREE_TIER_SEAT_LIMIT } from '@nao/shared/billing';

import type { ReactNode } from 'react';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type { CloudBillingStatus, OrganizationBillingState } from '@/hooks/use-organization-billing';
import { CloudBillingPlanComparison } from '@/components/settings/cloud-billing-plan-comparison';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { formatBillingDate, formatBillingPrice } from '@/lib/billing-display';

export function CloudBillingPlansTab({
	data,
	plans,
	billingState,
	onChoosePlan,
	onSwitchToFree,
}: {
	data: CloudBillingStatus;
	plans: CloudPlanOffer[];
	billingState: OrganizationBillingState;
	onChoosePlan: (plan: CloudPlanOffer) => void;
	onSwitchToFree: () => void;
}) {
	return (
		<>
			{data.trialAvailable ? (
				<CloudTrialSetupCard />
			) : (
				<CloudCurrentPlanCard
					data={data}
					billingState={billingState}
					disabled={billingState.isPlanSelectionPending}
					onCancelPendingChange={() => void billingState.cancelPendingPlanChange()}
				/>
			)}
			<CloudBillingPlanComparison
				plans={plans}
				currentTier={data.access.tier}
				currentPlanKey={data.current?.planKey ?? null}
				pendingPlanKey={data.pending?.planKey ?? null}
				cancellationScheduled={data.cancellationScheduled}
				interval={billingState.selectedBillingInterval}
				seatUserCount={data.access.seatUserCount}
				seatQuantity={data.access.seatQuantity}
				availableSeats={data.access.availableSeats}
				recommendation={
					data.recommendation === 'team' || data.recommendation === 'unlimited' ? data.recommendation : null
				}
				informational={data.trialAvailable}
				disabled={billingState.isPlanSelectionPending || billingState.isPortalPending || data.scheduleConflict}
				onIntervalChange={billingState.setSelectedBillingInterval}
				onChoose={data.trialAvailable || data.current?.legacy ? undefined : onChoosePlan}
				onChooseFree={data.trialAvailable || !data.current ? undefined : onSwitchToFree}
				onCancelPlan={onSwitchToFree}
				onKeepPlan={billingState.openPortal}
			/>
		</>
	);
}

function CloudTrialSetupCard() {
	return (
		<SettingsCard title='Plan overview'>
			<div className='py-4 text-center'>
				<p className='font-medium text-foreground'>Deploy a project and start your trial to choose a plan.</p>
				<p className='mt-1 text-sm text-muted-foreground'>You can review the available plans below.</p>
			</div>
		</SettingsCard>
	);
}

function CloudCurrentPlanCard({
	data,
	billingState,
	disabled,
	onCancelPendingChange,
}: {
	data: CloudBillingStatus;
	billingState: OrganizationBillingState;
	disabled: boolean;
	onCancelPendingChange: () => void;
}) {
	const currentPlan = getCurrentCloudPlanOverview(data);
	const nextPlan = getNextCloudPlanOverview(data, onCancelPendingChange);
	const nextPaymentEstimate =
		billingState.canLoadUpcomingInvoice &&
		!billingState.upcomingInvoice.isLoading &&
		!billingState.upcomingInvoice.isError
			? billingState.upcomingInvoice.data
			: null;

	return (
		<SettingsCard title='Plan overview'>
			<div className='grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-4'>
				<CloudPlanOverviewColumn plan={currentPlan} />
				<div className='my-4 flex justify-center sm:col-start-2 sm:row-span-5 sm:row-start-1 sm:my-0 sm:self-center'>
					<ArrowRightIcon className='size-5 rotate-90 text-muted-foreground sm:rotate-0' aria-hidden='true' />
				</div>
				<CloudPlanOverviewColumn
					plan={nextPlan}
					price={
						nextPaymentEstimate
							? formatBillingPrice(nextPaymentEstimate.amountDue, nextPaymentEstimate.currency)
							: undefined
					}
					promotions={nextPaymentEstimate?.promotionCodes}
					action={
						nextPlan.action ? (
							<Button
								className='mt-3'
								variant='secondary'
								size='sm'
								disabled={disabled}
								onClick={nextPlan.action.onClick}
							>
								{nextPlan.action.label}
							</Button>
						) : null
					}
				/>
			</div>
		</SettingsCard>
	);
}

type CloudPlanOverview = {
	badge: string;
	name: string;
	description: string;
	status?: string;
	note?: string;
	dateLabel?: string;
	date?: Date | null;
	action?: { label: string; onClick: () => void };
};

function CloudPlanOverviewColumn({
	plan,
	price,
	promotions,
	action,
	children,
}: {
	plan: CloudPlanOverview;
	price?: string;
	promotions?: string[];
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className='sm:col-start-auto'>
			<Badge variant='secondary'>{plan.badge}</Badge>
			<p className='mt-2 flex flex-wrap items-center gap-x-2 text-2xl font-semibold leading-none text-foreground'>
				<span>{plan.name}</span>
				{plan.status && (
					<Badge
						variant='outline'
						className='border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
					>
						{plan.status}
					</Badge>
				)}
				{price && <span className='text-base font-medium leading-none text-muted-foreground'>{price}</span>}
				{promotions?.map((promotion) => (
					<Badge key={promotion} variant='outline' className='self-center text-xs'>
						{promotion}
					</Badge>
				))}
			</p>
			<p className='mt-1 text-sm text-muted-foreground'>{plan.description}</p>
			{plan.note && <p className='mt-1 text-xs text-muted-foreground'>{plan.note}</p>}
			{plan.dateLabel && plan.date && (
				<p className='mt-3 text-sm text-muted-foreground'>
					{plan.dateLabel} <span className='font-medium text-foreground'>{formatBillingDate(plan.date)}</span>
				</p>
			)}
			{action}
			{children}
		</div>
	);
}

function getCurrentCloudPlanOverview(data: CloudBillingStatus): CloudPlanOverview {
	const tier = data.access.tier;
	const date =
		data.access.tier === 'trial' ? (data.access.trialEndsAt ?? data.trialEndsAt) : data.currentPeriodEndsAt;
	const paidAccess = tier === 'team' || tier === 'unlimited';
	return {
		badge: 'Now',
		name: getCloudPlanName(tier, data.access.seatQuantity ?? data.access.seatLimit),
		description: getCloudPlanDescription(tier, data.access.seatQuantity ?? data.access.seatLimit),
		status: paidAccess && data.cancellationScheduled ? 'Canceled' : undefined,
		note: data.current?.legacy ? 'Legacy Unlimited keeps its existing price and terms.' : undefined,
		dateLabel:
			tier === 'trial'
				? 'Trial ends'
				: data.cancellationScheduled || data.pending
					? 'Current plan ends'
					: paidAccess
						? 'Current period ends'
						: undefined,
		date,
	};
}

function getNextCloudPlanOverview(data: CloudBillingStatus, onCancelPendingChange: () => void): CloudPlanOverview {
	const trialing = data.access.tier === 'trial';
	const effectiveAt = trialing
		? (data.access.trialEndsAt ?? data.trialEndsAt)
		: (data.pending?.effectiveAt ?? data.currentPeriodEndsAt);
	if (trialing && data.current && !data.cancellationScheduled) {
		return {
			badge: 'After trial',
			name: getCloudPlanName(data.current.tier, data.current.seatQuantity),
			description: 'Nothing is charged during your trial; the estimate includes discounts, credits, and tax.',
			dateLabel: `${data.current.tier === 'team' ? 'Team' : 'Unlimited'} starts`,
			date: effectiveAt,
		};
	}
	if (trialing) {
		return {
			badge: 'After trial',
			name: 'Free',
			description: getCloudPlanDescription('free', data.access.seatLimit),
			dateLabel: 'Free starts',
			date: effectiveAt,
		};
	}
	if (data.cancellationScheduled) {
		return {
			badge: 'At renewal',
			name: 'Free',
			description: getCloudPlanDescription('free', data.access.seatLimit),
			dateLabel: 'Free starts',
			date: effectiveAt,
		};
	}
	if (data.pending) {
		const seatOnlyChange =
			data.current?.planKey === data.pending.planKey && data.pending.seatQuantity !== data.current.seatQuantity;
		return {
			badge: 'At renewal',
			name: getCloudPlanName(data.pending.tier, data.pending.seatQuantity),
			description: getCloudPlanDescription(data.pending.tier, data.pending.seatQuantity),
			dateLabel: seatOnlyChange
				? `Renews with ${data.pending.seatQuantity} seats`
				: `${data.pending.tier === 'team' ? 'Team' : 'Unlimited'} starts`,
			date: effectiveAt,
			action: { label: 'Cancel change', onClick: onCancelPendingChange },
		};
	}
	const tier = data.access.tier;
	const renewsAt = tier === 'team' || tier === 'unlimited' ? data.currentPeriodEndsAt : null;
	return {
		badge: renewsAt ? 'At renewal' : 'Ongoing',
		name: getCloudPlanName(tier, data.access.seatQuantity ?? data.access.seatLimit),
		description: getCloudPlanDescription(tier, data.access.seatQuantity ?? data.access.seatLimit),
		dateLabel: renewsAt ? 'Renews' : undefined,
		date: renewsAt,
	};
}

export function getCloudPlanName(tier: CloudBillingStatus['access']['tier'], seatQuantity: number | null) {
	if (tier === 'trial') {
		return 'Free trial';
	}
	if (tier === 'team') {
		return `Team · ${seatQuantity ?? '—'} seats`;
	}
	if (tier === 'unlimited' || tier === 'bypass') {
		return 'Unlimited';
	}
	return 'Free';
}

export function formatCloudPlanRecurringPrice(
	plan: CloudPlanOffer,
	seatQuantity: number | null,
	amount = plan.unitAmount * (plan.tier === 'team' ? (seatQuantity ?? 1) : 1),
): string {
	const interval = plan.interval === 'monthly' ? 'month' : 'year';
	return `${formatBillingPrice(amount, plan.currency)} / ${interval}`;
}

function getCloudPlanDescription(tier: CloudBillingStatus['access']['tier'], seatQuantity: number | null) {
	if (tier === 'trial') {
		return 'Full nao Cloud access for everyone while you try nao. No seat limits apply during the trial.';
	}
	if (tier === 'team') {
		return `${seatQuantity ?? '—'} seats for people who need full access. Viewers are free.`;
	}
	if (tier === 'unlimited' || tier === 'bypass') {
		return 'Full access for everyone in your organization.';
	}
	return `${FREE_TIER_SEAT_LIMIT} full-access seats and unlimited viewers. Everyone else keeps read-only access.`;
}
