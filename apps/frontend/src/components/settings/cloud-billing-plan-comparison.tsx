import { Check } from 'lucide-react';
import type { CloudBillingInterval, CloudBillingPlanKey, PaidCloudBillingTier } from '@nao/shared/billing';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { formatBillingPrice } from '@/lib/billing-display';
import { cn } from '@/lib/utils';

export type CloudPlanOffer = {
	planKey: CloudBillingPlanKey;
	tier: PaidCloudBillingTier;
	interval: CloudBillingInterval;
	currency: string;
	unitAmount: number;
	perSeat: boolean;
};

type PlanStatus = 'current' | 'after-trial' | 'scheduled';

const planStatusBadge: Record<PlanStatus, { label: string; variant: 'success' | 'secondary' }> = {
	current: { label: 'Current plan', variant: 'success' },
	'after-trial': { label: 'After trial', variant: 'secondary' },
	scheduled: { label: 'Scheduled', variant: 'secondary' },
};

const planStatusActionLabel: Record<PlanStatus, string> = {
	current: 'Current plan',
	'after-trial': 'Starts after trial',
	scheduled: 'Scheduled',
};

export function CloudBillingPlanComparison({
	plans,
	currentTier,
	currentPlanKey,
	pendingPlanKey,
	cancellationScheduled,
	interval,
	seatUserCount,
	seatQuantity,
	availableSeats,
	recommendation,
	disabled,
	onIntervalChange,
	onChoose,
	onChooseFree,
}: {
	plans: CloudPlanOffer[];
	currentTier: string;
	currentPlanKey: string | null;
	pendingPlanKey: string | null;
	cancellationScheduled: boolean;
	interval: CloudBillingInterval;
	seatUserCount: number;
	seatQuantity: number | null;
	availableSeats: number | null;
	recommendation: PaidCloudBillingTier | null;
	disabled?: boolean;
	onIntervalChange: (interval: CloudBillingInterval) => void;
	onChoose: (plan: CloudPlanOffer) => void;
	onChooseFree?: () => void;
}) {
	const selectedPlans = plans.filter((plan) => plan.interval === interval);
	const team = selectedPlans.find((plan) => plan.tier === 'team');
	const unlimited = selectedPlans.find((plan) => plan.tier === 'unlimited');
	const teamYearlyDiscount = getYearlyDiscount(
		plans.find((plan) => plan.tier === 'team' && plan.interval === 'monthly'),
		plans.find((plan) => plan.tier === 'team' && plan.interval === 'yearly'),
	);
	const unlimitedYearlyDiscount = getYearlyDiscount(
		plans.find((plan) => plan.tier === 'unlimited' && plan.interval === 'monthly'),
		plans.find((plan) => plan.tier === 'unlimited' && plan.interval === 'yearly'),
	);
	const currency = team?.currency ?? unlimited?.currency ?? 'usd';
	const intervalLabel = interval === 'monthly' ? 'month' : 'year';
	const trialing = currentTier === 'trial';
	const paidStatus = (plan: CloudPlanOffer): PlanStatus | undefined =>
		currentTier === plan.tier && currentPlanKey === plan.planKey
			? 'current'
			: trialing && currentPlanKey === plan.planKey && !cancellationScheduled
				? 'after-trial'
				: pendingPlanKey === plan.planKey
					? 'scheduled'
					: undefined;
	const teamStatus = team ? paidStatus(team) : undefined;
	const unlimitedStatus = unlimited ? paidStatus(unlimited) : undefined;
	const teamTotal = team
		? `${formatBillingPrice(team.unitAmount * (seatQuantity ?? 4), team.currency)} total for ${seatQuantity ?? 4} seats / ${intervalLabel}`
		: '';
	const freeStatus: PlanStatus | undefined =
		currentTier === 'free'
			? 'current'
			: trialing && (currentPlanKey === null || cancellationScheduled)
				? 'after-trial'
				: cancellationScheduled
					? 'scheduled'
					: undefined;

	return (
		<SettingsCard
			title='Compare plans'
			description='All plans include every nao feature. Choose how much full-access capacity you need.'
			action={
				<div
					className='inline-flex shrink-0 rounded-lg bg-muted p-1'
					role='group'
					aria-label='Billing interval'
				>
					{(['monthly', 'yearly'] as const).map((value) => (
						<Button
							key={value}
							variant={interval === value ? 'default' : 'ghost'}
							size='sm'
							aria-pressed={interval === value}
							onClick={() => onIntervalChange(value)}
							disabled={disabled}
						>
							{value === 'monthly' ? 'Monthly' : 'Yearly'}
						</Button>
					))}
				</div>
			}
		>
			<div className='grid gap-4 lg:grid-cols-3'>
				<PlanCard
					name='Free'
					price={formatBillingPrice(0, currency)}
					priceSuffix='forever'
					supportingText='No card required'
					status={freeStatus}
					features={[
						'3 full-access seats included',
						'Unlimited viewers',
						'Use your own model keys or nao credits',
					]}
					actionLabel={
						freeStatus
							? planStatusActionLabel[freeStatus]
							: onChooseFree
								? trialing
									? 'Use Free after trial'
									: 'Switch to Free'
								: undefined
					}
					actionDisabled={disabled || freeStatus !== undefined}
					onAction={onChooseFree}
				/>
				{team && (
					<PlanCard
						name='Team'
						price={formatBillingPrice(team.unitAmount, team.currency)}
						priceSuffix={`per seat / ${intervalLabel}`}
						supportingText={teamStatus === 'current' ? teamTotal : 'Choose 4–40 paid seats'}
						status={teamStatus}
						discount={interval === 'yearly' ? teamYearlyDiscount : null}
						features={[
							'Starts at 4 full-access seats',
							'Viewers are free',
							'Reuse seats as your team changes',
						]}
						notice={
							currentTier === 'team'
								? `${seatUserCount} using seats · ${seatQuantity ?? '—'} purchased · ${availableSeats ?? '—'} available`
								: undefined
						}
						actionLabel={teamStatus ? planStatusActionLabel[teamStatus] : 'Choose Team'}
						actionDisabled={disabled || teamStatus !== undefined}
						onAction={() => onChoose(team)}
					/>
				)}
				{unlimited && (
					<PlanCard
						name='Unlimited'
						price={formatBillingPrice(unlimited.unitAmount, unlimited.currency)}
						priceSuffix={`per ${intervalLabel}`}
						supportingText='One price for your whole organization'
						status={unlimitedStatus}
						recommended={recommendation === 'unlimited'}
						discount={interval === 'yearly' ? unlimitedYearlyDiscount : null}
						features={['Unlimited full-access users', 'Unlimited viewers', 'No seat management']}
						actionLabel={unlimitedStatus ? planStatusActionLabel[unlimitedStatus] : 'Choose Unlimited'}
						actionDisabled={disabled || unlimitedStatus !== undefined}
						onAction={() => onChoose(unlimited)}
					/>
				)}
			</div>
		</SettingsCard>
	);
}

function PlanCard({
	name,
	price,
	priceSuffix,
	supportingText,
	features,
	status,
	recommended,
	discount,
	notice,
	actionLabel,
	actionDisabled,
	onAction,
}: {
	name: string;
	price: string;
	priceSuffix: string;
	supportingText: string;
	features: string[];
	status?: PlanStatus;
	recommended?: boolean;
	discount?: string | null;
	notice?: string;
	actionLabel?: string;
	actionDisabled?: boolean;
	onAction?: () => void;
}) {
	return (
		<section
			className={cn(
				'flex min-w-0 flex-col gap-4 rounded-xl border p-5',
				status === 'current' && 'border-primary bg-primary/[0.03]',
				status && status !== 'current' && 'border-dashed border-primary/50',
				!status && 'border-border',
			)}
			aria-label={`${name} plan`}
		>
			<div className='flex flex-wrap items-center gap-2'>
				<h3 className='font-semibold'>{name}</h3>
				{status && <Badge variant={planStatusBadge[status].variant}>{planStatusBadge[status].label}</Badge>}
				{recommended && !status && <Badge>Recommended</Badge>}
				{discount && <Badge>{discount} off</Badge>}
			</div>
			<div>
				<p className='flex flex-wrap items-baseline gap-x-1.5'>
					<span className='text-2xl font-semibold text-foreground'>{price}</span>
					<span className='text-sm text-muted-foreground'>{priceSuffix}</span>
				</p>
				<p className='mt-1 text-xs text-muted-foreground'>{supportingText}</p>
			</div>
			<ul className='flex-1 space-y-2.5 text-sm text-muted-foreground'>
				{features.map((feature) => (
					<li key={feature} className='flex gap-2'>
						<Check
							className='mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500'
							aria-hidden='true'
						/>
						<span>{feature}</span>
					</li>
				))}
			</ul>
			{notice && <p className='rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>{notice}</p>}
			{actionLabel && (
				<Button variant='secondary' disabled={actionDisabled} onClick={onAction}>
					{actionLabel}
				</Button>
			)}
		</section>
	);
}

function getYearlyDiscount(monthly: CloudPlanOffer | undefined, yearly: CloudPlanOffer | undefined): string | null {
	if (!monthly || !yearly || monthly.currency !== yearly.currency) {
		return null;
	}
	const savings = 1 - yearly.unitAmount / (monthly.unitAmount * 12);
	return savings > 0
		? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(savings)
		: null;
}
