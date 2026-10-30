import { Link } from '@tanstack/react-router';
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

export function CloudBillingPlanComparison({
	plans,
	currentTier,
	currentPlanKey,
	interval,
	seatUserCount,
	seatQuantity,
	availableSeats,
	recommendation,
	disabled,
	onIntervalChange,
	onChoose,
}: {
	plans: CloudPlanOffer[];
	currentTier: string;
	currentPlanKey: string | null;
	interval: CloudBillingInterval;
	seatUserCount: number;
	seatQuantity: number | null;
	availableSeats: number | null;
	recommendation: PaidCloudBillingTier | null;
	disabled?: boolean;
	onIntervalChange: (interval: CloudBillingInterval) => void;
	onChoose: (plan: CloudPlanOffer) => void;
}) {
	const selectedPlans = plans.filter((plan) => plan.interval === interval);
	const team = selectedPlans.find((plan) => plan.tier === 'team');
	const unlimited = selectedPlans.find((plan) => plan.tier === 'unlimited');
	const yearlyDiscount = getYearlyDiscount(
		plans.find((plan) => plan.tier === 'team' && plan.interval === 'monthly'),
		plans.find((plan) => plan.tier === 'team' && plan.interval === 'yearly'),
	);
	const currency = team?.currency ?? unlimited?.currency ?? 'usd';
	const requiredTeamSeats = Math.max(4, seatUserCount);
	const intervalLabel = interval === 'monthly' ? 'month' : 'year';
	const teamStatus =
		currentTier === 'team'
			? 'current'
			: currentTier === 'trial' && currentPlanKey === team?.planKey
				? 'after-trial'
				: undefined;
	const unlimitedStatus =
		currentTier === 'unlimited'
			? 'current'
			: currentTier === 'trial' && currentPlanKey === unlimited?.planKey
				? 'after-trial'
				: undefined;

	return (
		<SettingsCard
			title='Compare plans'
			description='All plans include every nao feature. Choose how much full-access capacity you need.'
		>
			<div className='mb-4 flex flex-wrap items-center gap-3'>
				<div className='inline-flex rounded-lg bg-muted p-1' role='group' aria-label='Billing interval'>
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
				{yearlyDiscount !== null && <Badge variant='success'>Save {yearlyDiscount} yearly</Badge>}
			</div>
			<div className='grid gap-4 lg:grid-cols-3'>
				<PlanCard
					name='Free'
					price={formatBillingPrice(0, currency)}
					priceSuffix='forever'
					supportingText='No card required'
					status={currentTier === 'free' ? 'current' : undefined}
					features={[
						'3 full-access seats included',
						'Unlimited viewers',
						'Use your own model keys or nao credits',
					]}
					notice={
						currentTier === 'trial'
							? 'You will move to Free after your trial if no paid plan starts.'
							: undefined
					}
				/>
				{team && (
					<PlanCard
						name='Team'
						price={formatBillingPrice(team.unitAmount, team.currency)}
						priceSuffix={`per seat / ${intervalLabel}`}
						supportingText={`${formatBillingPrice(team.unitAmount * requiredTeamSeats, team.currency)} total for ${requiredTeamSeats} seats / ${intervalLabel}`}
						status={teamStatus}
						recommended={recommendation === 'team'}
						features={[
							'Starts at 4 full-access seats',
							'Viewers are free',
							'Reuse seats as your team changes',
						]}
						notice={
							currentTier === 'team'
								? `${seatUserCount} using seats · ${seatQuantity ?? '—'} purchased · ${availableSeats ?? '—'} available`
								: seatUserCount < 4
									? `Add ${4 - seatUserCount} more full-access ${4 - seatUserCount === 1 ? 'user' : 'users'} to choose Team.`
									: undefined
						}
						actionLabel={
							teamStatus === 'current'
								? 'Current plan'
								: teamStatus === 'after-trial'
									? 'Starts after trial'
									: seatUserCount < 4
										? 'Manage members'
										: 'Choose Team'
						}
						actionHref={seatUserCount < 4 && !teamStatus ? '/settings/organization/members' : undefined}
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
						features={['Unlimited full-access users', 'Unlimited viewers', 'No seat management']}
						actionLabel={
							unlimitedStatus === 'current'
								? 'Current plan'
								: unlimitedStatus === 'after-trial'
									? 'Starts after trial'
									: 'Choose Unlimited'
						}
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
	notice,
	actionLabel,
	actionHref,
	actionDisabled,
	onAction,
}: {
	name: string;
	price: string;
	priceSuffix: string;
	supportingText: string;
	features: string[];
	status?: 'current' | 'after-trial';
	recommended?: boolean;
	notice?: string;
	actionLabel?: string;
	actionHref?: '/settings/organization/members';
	actionDisabled?: boolean;
	onAction?: () => void;
}) {
	return (
		<section
			className={cn(
				'flex min-w-0 flex-col gap-4 rounded-xl border p-5',
				status ? 'border-primary/50 bg-primary/[0.03]' : 'border-border',
			)}
			aria-label={`${name} plan`}
		>
			<div className='flex flex-wrap items-center gap-2'>
				<h3 className='font-semibold'>{name}</h3>
				{status === 'current' && <Badge variant='success'>Current plan</Badge>}
				{status === 'after-trial' && <Badge variant='secondary'>After trial</Badge>}
				{recommended && !status && <Badge>Recommended</Badge>}
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
			{actionLabel &&
				(actionHref ? (
					<Button variant='secondary' asChild>
						<Link to={actionHref}>{actionLabel}</Link>
					</Button>
				) : (
					onAction && (
						<Button variant='secondary' disabled={actionDisabled} onClick={onAction}>
							{actionLabel}
						</Button>
					)
				))}
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
