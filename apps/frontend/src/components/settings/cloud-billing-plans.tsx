import { ArrowRightIcon, Check } from 'lucide-react';
import { CLOUD_BILLING_CURRENCIES, CLOUD_BILLING_PLANS, findCloudBillingPlan } from '@nao/shared/billing';
import type {
	CloudBillingCurrency,
	CloudBillingInterval,
	CloudBillingPlanDefinition,
	CloudBillingTier,
} from '@nao/shared/billing';

import type { ReactNode } from 'react';
import type { CloudBillingStatus, OrganizationBillingState } from '@/hooks/use-organization-billing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { formatBillingDate, formatBillingPrice, getBillingStatusView } from '@/lib/billing-display';
import { cn } from '@/lib/utils';

export type CloudPlanOffer = CloudBillingPlanDefinition & { currency: string };

const PAYMENT_ISSUE_STATUSES: string[] = ['past_due', 'unpaid', 'paused', 'incomplete'];

type PlanStatus = 'current' | 'after-trial' | 'scheduled';

const planStatusBadge: Record<PlanStatus, { label: string; variant: 'default' | 'secondary' }> = {
	current: { label: 'Current plan', variant: 'default' },
	'after-trial': { label: 'After trial', variant: 'secondary' },
	scheduled: { label: 'Scheduled', variant: 'secondary' },
};

const planStatusActionLabel: Record<PlanStatus, string> = {
	current: 'Current plan',
	'after-trial': 'Starts after trial',
	scheduled: 'Scheduled',
};

export function CloudBillingPlans({
	data,
	billingState,
	onChoosePlan,
	onSwitchToFree,
}: {
	data: CloudBillingStatus;
	billingState: OrganizationBillingState;
	onChoosePlan: (plan: CloudPlanOffer) => void;
	onSwitchToFree: () => void;
}) {
	const disabled = billingState.isCommandPending || billingState.isCheckoutPending;
	return (
		<>
			{data.trialAvailable ? (
				<SettingsCard title='Plan overview'>
					<div className='py-4 text-center'>
						<p className='font-medium text-foreground'>
							Deploy a project and start your trial to choose a plan.
						</p>
						<p className='mt-1 text-sm text-muted-foreground'>You can review the available plans below.</p>
					</div>
				</SettingsCard>
			) : (
				<PlanOverview data={data} billingState={billingState} disabled={disabled} />
			)}
			<PlanComparison
				data={data}
				interval={billingState.selectedBillingInterval}
				currency={billingState.billingCurrency}
				disabled={disabled}
				onIntervalChange={billingState.setSelectedBillingInterval}
				onCurrencyChange={
					billingState.isBillingCurrencyLocked ? undefined : billingState.setSelectedBillingCurrency
				}
				onChoose={data.trialAvailable || data.plan?.legacy ? undefined : onChoosePlan}
				onChooseFree={data.trialAvailable || !data.plan || data.plan.legacy ? undefined : onSwitchToFree}
				onKeepPlan={billingState.keepPlan}
			/>
			{!data.plan && !data.trialAvailable && (
				<p className='text-xs text-muted-foreground'>
					To create your organization&apos;s Stripe billing profile, nao shares an organization admin&apos;s
					email address with Stripe.{' '}
					<a
						href='https://getnao.io/privacy'
						target='_blank'
						rel='noreferrer'
						className='underline underline-offset-2'
					>
						Privacy policy
					</a>
					.
				</p>
			)}
			{billingState.checkoutError && (
				<p className='text-sm text-destructive' role='alert'>
					{billingState.checkoutError}
				</p>
			)}
		</>
	);
}

export function getCloudPlanOffers(currency: string): CloudPlanOffer[] {
	return Object.values(CLOUD_BILLING_PLANS).map((plan) => ({ ...plan, currency }));
}

export function getCloudPlanName(tier: CloudBillingTier, seats: number | null) {
	if (tier === 'trial') {
		return 'Free trial';
	}
	if (tier === 'team') {
		return `Team · ${seats ?? '—'} seats`;
	}
	return tier === 'free' ? 'Free' : 'Unlimited';
}

export function formatCloudPlanPrice(plan: CloudPlanOffer, seats: number | null) {
	const interval = plan.interval === 'monthly' ? 'month' : 'year';
	if (plan.tier === 'team' && seats === null) {
		return `${formatBillingPrice(plan.unitAmount, plan.currency)} / seat / ${interval}`;
	}
	return `${formatBillingPrice(plan.unitAmount * (plan.tier === 'team' ? (seats ?? 1) : 1), plan.currency)} / ${interval}`;
}

function PlanOverview({
	data,
	billingState,
	disabled,
}: {
	data: CloudBillingStatus;
	billingState: OrganizationBillingState;
	disabled: boolean;
}) {
	const nextPlan = getNextPlanOverview(data);
	const estimate =
		billingState.canLoadUpcomingInvoice && !billingState.upcomingInvoice.isError
			? billingState.upcomingInvoice.data
			: null;

	return (
		<SettingsCard title='Plan overview'>
			<div className='grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-4'>
				<PlanOverviewColumn plan={getCurrentPlanOverview(data)} />
				<div className='my-4 flex justify-center sm:my-0 sm:self-center'>
					<ArrowRightIcon className='size-5 rotate-90 text-muted-foreground sm:rotate-0' aria-hidden='true' />
				</div>
				<PlanOverviewColumn
					plan={nextPlan}
					price={estimate ? formatBillingPrice(estimate.amountDue, estimate.currency) : undefined}
					promotions={estimate?.promotionCodes}
					action={
						data.pending && (
							<Button
								className='mt-3'
								variant='secondary'
								size='sm'
								disabled={disabled}
								onClick={billingState.cancelPendingChange}
							>
								Cancel change
							</Button>
						)
					}
				/>
			</div>
			{billingState.managementError && (
				<p className='mt-3 text-sm text-destructive' role='alert'>
					{billingState.managementError}
				</p>
			)}
		</SettingsCard>
	);
}

type PlanOverviewItem = {
	badge: string;
	name: string;
	description: string;
	status?: string;
	note?: string;
	dateLabel?: string;
	date?: Date | null;
};

function PlanOverviewColumn({
	plan,
	price,
	promotions,
	action,
}: {
	plan: PlanOverviewItem;
	price?: string;
	promotions?: string[];
	action?: ReactNode;
}) {
	return (
		<div>
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
		</div>
	);
}

function PlanComparison({
	data,
	interval,
	currency,
	disabled,
	onIntervalChange,
	onCurrencyChange,
	onChoose,
	onChooseFree,
	onKeepPlan,
}: {
	data: CloudBillingStatus;
	interval: CloudBillingInterval;
	currency: CloudBillingCurrency;
	disabled: boolean;
	onIntervalChange: (interval: CloudBillingInterval) => void;
	onCurrencyChange?: (currency: CloudBillingCurrency) => void;
	onChoose?: (plan: CloudPlanOffer) => void;
	onChooseFree?: () => void;
	onKeepPlan: () => void;
}) {
	const offers = getCloudPlanOffers(currency);
	const offer = (tier: CloudPlanOffer['tier'], planInterval = interval) =>
		offers.find((plan) => plan.tier === tier && plan.interval === planInterval)!;
	const team = offer('team');
	const unlimited = offer('unlimited');
	const { freeSeatLimit, teamMinSeats, teamMaxSeats } = data.policy;
	const intervalLabel = interval === 'monthly' ? 'month' : 'year';
	const trialing = data.tier === 'trial';
	const informational = data.trialAvailable;
	const currentPlanKey = data.plan?.key ?? null;
	const seatedCount = data.members.filter((member) => member.seated).length;
	const paidStatus = (plan: CloudPlanOffer): PlanStatus | undefined => {
		if (informational) {
			return undefined;
		}
		if (currentPlanKey === plan.key) {
			return trialing ? (data.cancellationScheduled ? undefined : 'after-trial') : 'current';
		}
		return data.pending?.planKey === plan.key ? 'scheduled' : undefined;
	};
	const paidAction = (plan: CloudPlanOffer, status: PlanStatus | undefined) => {
		if (status === 'current') {
			return data.cancellationScheduled
				? { label: 'Keep my plan', disabled, onAction: onKeepPlan }
				: { label: 'Cancel plan', disabled: disabled || !onChooseFree, onAction: onChooseFree };
		}
		if (!onChoose) {
			return undefined;
		}
		return {
			label: status ? planStatusActionLabel[status] : `Choose ${plan.tier === 'team' ? 'Team' : 'Unlimited'}`,
			disabled:
				disabled || status !== undefined || data.pending !== null || (data.cancellationScheduled && !trialing),
			onAction: () => onChoose(plan),
		};
	};
	const teamStatus = paidStatus(team);
	const unlimitedStatus = paidStatus(unlimited);
	const teamAction = paidAction(team, teamStatus);
	const unlimitedAction = paidAction(unlimited, unlimitedStatus);
	const freeStatus: PlanStatus | undefined = informational
		? undefined
		: data.tier === 'free'
			? 'current'
			: trialing && (currentPlanKey === null || data.cancellationScheduled)
				? 'after-trial'
				: data.cancellationScheduled
					? 'scheduled'
					: undefined;

	return (
		<SettingsCard
			title='Compare plans'
			description='All plans include every nao feature. Choose how much full-access capacity you need.'
			action={
				<div className='flex flex-wrap gap-2'>
					{onCurrencyChange && (
						<BillingToggle
							label='Billing currency'
							options={CLOUD_BILLING_CURRENCIES.map((value) => ({ value, label: value.toUpperCase() }))}
							value={currency}
							disabled={disabled}
							onChange={onCurrencyChange}
						/>
					)}
					<BillingToggle
						label='Billing interval'
						options={[
							{ value: 'monthly', label: 'Monthly' },
							{ value: 'yearly', label: 'Yearly' },
						]}
						value={interval}
						disabled={disabled}
						onChange={onIntervalChange}
					/>
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
						`Full access for up to ${freeSeatLimit} people`,
						'Unlimited viewers',
						'Best for individuals and small teams',
					]}
					actionLabel={
						freeStatus
							? planStatusActionLabel[freeStatus]
							: onChooseFree && (trialing ? 'Choose Free' : 'Switch to Free')
					}
					actionDisabled={disabled || freeStatus !== undefined || data.pending !== null}
					onAction={onChooseFree}
				/>
				<PlanCard
					name='Team'
					price={formatBillingPrice(team.unitAmount, team.currency)}
					priceSuffix={`per seat / ${intervalLabel}`}
					supportingText={
						teamStatus === 'current'
							? `${formatCloudPlanPrice(team, data.seatQuantity)} for ${data.seatQuantity ?? '—'} seats`
							: `Choose ${teamMinSeats}–${teamMaxSeats} paid seats`
					}
					status={teamStatus}
					recommended={!informational && data.recommendation === 'team'}
					discount={interval === 'yearly' ? getYearlyDiscount(offer('team', 'monthly'), team) : null}
					features={[
						`Full access for ${teamMinSeats}–${teamMaxSeats} people`,
						'Add seats as your team grows',
						'Reassign seats whenever your team changes',
						'Unlimited viewers',
					]}
					notice={
						data.tier === 'team'
							? `${seatedCount} seated · ${data.seatQuantity ?? '—'} purchased · ${data.members.length} need full access`
							: undefined
					}
					actionLabel={teamAction?.label}
					actionDisabled={teamAction?.disabled}
					onAction={teamAction?.onAction}
				/>
				<PlanCard
					name='Unlimited'
					price={formatBillingPrice(unlimited.unitAmount, unlimited.currency)}
					priceSuffix={`per ${intervalLabel}`}
					supportingText='One price for your whole organization'
					status={unlimitedStatus}
					recommended={!informational && data.recommendation === 'unlimited'}
					discount={
						interval === 'yearly' ? getYearlyDiscount(offer('unlimited', 'monthly'), unlimited) : null
					}
					features={[
						'Full access for your whole organization',
						'No seat limits or seat management',
						'Predictable flat price as you grow',
						'Unlimited viewers',
					]}
					actionLabel={unlimitedAction?.label}
					actionDisabled={unlimitedAction?.disabled}
					onAction={unlimitedAction?.onAction}
				/>
			</div>
		</SettingsCard>
	);
}

function BillingToggle<Value extends string>({
	label,
	options,
	value,
	disabled,
	onChange,
}: {
	label: string;
	options: { value: Value; label: string }[];
	value: Value;
	disabled: boolean;
	onChange: (value: Value) => void;
}) {
	return (
		<div className='inline-flex shrink-0 rounded-lg bg-muted p-1' role='group' aria-label={label}>
			{options.map((option) => (
				<Button
					key={option.value}
					variant={value === option.value ? 'default' : 'ghost'}
					size='sm'
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
					disabled={disabled}
				>
					{option.label}
				</Button>
			))}
		</div>
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
						<Check className='mt-0.5 size-4 shrink-0 text-primary' aria-hidden='true' />
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

function getCurrentPlanOverview(data: CloudBillingStatus): PlanOverviewItem {
	const paidAccess = data.tier === 'team' || data.tier === 'unlimited';
	const seats = data.seatQuantity ?? data.seatLimit;
	return {
		badge: 'Now',
		name: getCloudPlanName(data.tier, seats),
		description: getCloudPlanDescription(data.tier, seats, data.policy.freeSeatLimit),
		status:
			paidAccess && data.cancellationScheduled
				? 'Canceled'
				: data.status && PAYMENT_ISSUE_STATUSES.includes(data.status)
					? getBillingStatusView(data.status, false, data.hasDefaultPaymentMethod === true, true).label
					: undefined,
		note: data.plan?.legacy ? 'Your legacy plan keeps its existing price and terms.' : undefined,
		dateLabel:
			data.tier === 'trial'
				? 'Trial ends'
				: data.cancellationScheduled || data.pending
					? 'Current plan ends'
					: paidAccess
						? 'Current period ends'
						: undefined,
		date: data.tier === 'trial' ? data.trialEndsAt : data.currentPeriodEndsAt,
	};
}

function getNextPlanOverview(data: CloudBillingStatus): PlanOverviewItem {
	const trialing = data.tier === 'trial';
	const free = {
		badge: trialing ? 'After trial' : 'At renewal',
		name: 'Free',
		description: getCloudPlanDescription('free', null, data.policy.freeSeatLimit),
		dateLabel: 'Free starts',
		date: trialing ? data.trialEndsAt : data.currentPeriodEndsAt,
	};
	if (trialing && data.plan && !data.cancellationScheduled) {
		const tier = data.plan.tier;
		return {
			badge: 'After trial',
			name: getCloudPlanName(tier, data.seatQuantity),
			description: 'Nothing is charged during your trial. The estimate includes discounts, credits, and tax.',
			dateLabel: `${tier === 'team' ? 'Team' : 'Unlimited'} starts`,
			date: data.trialEndsAt,
		};
	}
	if (trialing || data.cancellationScheduled) {
		return free;
	}
	const pendingPlan = findCloudBillingPlan(data.pending?.planKey);
	if (data.pending && pendingPlan) {
		const seatOnlyChange = data.pending.planKey === data.plan?.key;
		return {
			badge: 'At renewal',
			name: getCloudPlanName(pendingPlan.tier, data.pending.seats),
			description: getCloudPlanDescription(pendingPlan.tier, data.pending.seats, data.policy.freeSeatLimit),
			dateLabel: seatOnlyChange
				? `Renews with ${data.pending.seats} seats`
				: `${pendingPlan.tier === 'team' ? 'Team' : 'Unlimited'} starts`,
			date: data.pending.effectiveAt,
		};
	}
	const paidAccess = data.tier === 'team' || data.tier === 'unlimited';
	const seats = data.seatQuantity ?? data.seatLimit;
	return {
		badge: paidAccess ? 'At renewal' : 'Ongoing',
		name: getCloudPlanName(data.tier, seats),
		description: getCloudPlanDescription(data.tier, seats, data.policy.freeSeatLimit),
		dateLabel: paidAccess ? 'Renews' : undefined,
		date: paidAccess ? data.currentPeriodEndsAt : null,
	};
}

function getCloudPlanDescription(tier: CloudBillingTier, seats: number | null, freeSeatLimit: number) {
	if (tier === 'trial') {
		return 'Full nao Cloud access for everyone while you try nao. No seat limits apply during the trial.';
	}
	if (tier === 'team') {
		return `${seats ?? '—'} seats for people who need full access. Viewers are free.`;
	}
	if (tier === 'free') {
		return `${freeSeatLimit} full-access seats and unlimited viewers. Everyone else keeps read-only access.`;
	}
	return 'Full access for everyone in your organization.';
}

function getYearlyDiscount(monthly: CloudPlanOffer, yearly: CloudPlanOffer): string | null {
	const savings = 1 - yearly.unitAmount / (monthly.unitAmount * 12);
	return savings > 0
		? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(savings)
		: null;
}
