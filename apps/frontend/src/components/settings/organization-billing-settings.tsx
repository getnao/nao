import { useState } from 'react';

import type {
	BillingInterval,
	OrganizationBillingSearch,
	OrganizationBillingTab,
} from '@/hooks/use-organization-billing';
import type { OrganizationCreditsTab } from '@/components/settings/credits-wallet-content';
import type { CloudPlanOffer } from '@/components/settings/cloud-billing-plan-comparison';
import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-dialog';

import { CloudBillingChangeDialog } from '@/components/settings/cloud-billing-change-dialog';
import { CloudBillingPlanComparison } from '@/components/settings/cloud-billing-plan-comparison';
import { CloudBillingSeatsCard } from '@/components/settings/cloud-billing-seats-card';
import { CloudBillingSwitchToFreeDialog } from '@/components/settings/cloud-billing-switch-to-free-dialog';
import { CloudBillingTeamSeatsDialog } from '@/components/settings/cloud-billing-team-seats-dialog';
import { OrganizationCreditsContent } from '@/components/settings/credits-wallet-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { useOrganizationBilling } from '@/hooks/use-organization-billing';
import { usePermissions } from '@/hooks/use-permissions';
import {
	formatBillingDate,
	formatBillingInterval,
	formatBillingPrice,
	formatBillingStatus,
	formatInvoiceLabel,
	getBillingManagementDescription,
	getBillingPortalButtonLabel,
} from '@/lib/billing-display';
import { cn } from '@/lib/utils';

type BillingState = ReturnType<typeof useOrganizationBilling>;
type CloudBillingData = Extract<NonNullable<BillingState['billing']['data']>, { access: unknown }>;

export function OrganizationBillingSettings({
	search,
	onTabChange,
	onCreditsTabChange,
}: {
	search: OrganizationBillingSearch;
	onTabChange?: (tab: OrganizationBillingTab) => void;
	onCreditsTabChange?: (tab: OrganizationCreditsTab) => void;
}) {
	const billingState = useOrganizationBilling(search);
	const { canViewChatReplay } = usePermissions();
	const activeTab = getActiveBillingTab(search, billingState.freeTierEnabled);

	if (billingState.freeTierEnabled) {
		return (
			<CloudOrganizationBillingSettings
				billingState={billingState}
				canViewChatReplay={canViewChatReplay}
				search={search}
				activeTab={activeTab}
				onTabChange={onTabChange}
				onCreditsTabChange={onCreditsTabChange}
			/>
		);
	}

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Billing & Credits</h1>
					<p className='text-sm text-muted-foreground'>
						Review your current plan, subscription history, invoices, and billing actions.
					</p>
				</div>

				<BillingTabs activeTab={activeTab} showSeats={false} onTabChange={onTabChange} />
				<BillingFeedback billingState={billingState} />

				{activeTab === 'plans' && (
					<div className='flex flex-col gap-12'>
						<CurrentPlanCard billingState={billingState} />
						<BillingSetupCard billingState={billingState} />
						<PlanDetailsCard billingState={billingState} />
						<SubscriptionRecoveryCard billingState={billingState} />
					</div>
				)}
				{activeTab === 'credits' && (
					<section className='flex flex-col gap-4'>
						<div>
							<h2 className='text-base font-semibold text-foreground'>Organization credits</h2>
							<p className='text-sm text-muted-foreground'>
								Fund and review the shared nao AI wallet for this organization.
							</p>
						</div>
						<OrganizationCreditsContent
							creditCheckout={search.creditCheckout}
							canViewReplay={canViewChatReplay}
							activeTab={search.creditsTab ?? 'history'}
							onTabChange={onCreditsTabChange}
						/>
					</section>
				)}
				{activeTab === 'invoices' && (
					<div className='flex flex-col gap-12'>
						<InvoicesCard billingState={billingState} />
						<BillingManagementCard billingState={billingState} />
					</div>
				)}
			</div>
		</SettingsPageWrapper>
	);
}

function CloudOrganizationBillingSettings({
	billingState,
	canViewChatReplay,
	search,
	activeTab,
	onTabChange,
	onCreditsTabChange,
}: {
	billingState: BillingState;
	canViewChatReplay: boolean;
	search: OrganizationBillingSearch;
	activeTab: OrganizationBillingTab;
	onTabChange?: (tab: OrganizationBillingTab) => void;
	onCreditsTabChange?: (tab: OrganizationCreditsTab) => void;
}) {
	const [changePreview, setChangePreview] = useState<CloudBillingChangePreview>(null);
	const [changeTitle, setChangeTitle] = useState('Confirm plan change');
	const [refreshPreview, setRefreshPreview] = useState<() => Promise<CloudBillingChangePreview>>(
		() => async () => null,
	);
	const [switchToFreeOpen, setSwitchToFreeOpen] = useState(false);
	const [selectedTeamPlan, setSelectedTeamPlan] = useState<CloudPlanOffer | null>(null);
	const data = billingState.billing.data;
	if (!data || !('access' in data)) {
		return (
			<SettingsPageWrapper wide>
				<p role='status'>Loading billing details…</p>
			</SettingsPageWrapper>
		);
	}

	const plans = data.availablePlans as CloudPlanOffer[];
	const currentPlanEndsAt =
		data.access.tier === 'trial' ? (data.access.trialEndsAt ?? data.currentPeriodEndsAt) : data.currentPeriodEndsAt;
	const previewPlan = async (plan: CloudPlanOffer, seatQuantity?: number) => {
		billingState.setSelectedBillingTier(plan.tier);
		const runPreview = () =>
			billingState.previewPlanChange(plan.planKey, plan.tier === 'team' ? seatQuantity : undefined);
		if (!data.current) {
			if (data.trialAvailable || data.needsPaidPlanSelection) {
				billingState.openTrialCheckoutForPlan(plan.planKey, seatQuantity);
			} else {
				billingState.resubscribeForPlan(plan.planKey, seatQuantity);
			}
			return;
		}
		setChangeTitle(`Change to ${plan.tier === 'team' ? 'Team' : 'Unlimited'}`);
		setRefreshPreview(() => runPreview);
		setChangePreview(await runPreview());
	};

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Billing & Credits</h1>
					<p className='text-sm text-muted-foreground'>
						Manage plans, paid capacity, invoices, and your organization&apos;s nao credits.
					</p>
				</div>
				<BillingTabs activeTab={activeTab} showSeats onTabChange={onTabChange} />
				<BillingFeedback billingState={billingState} />
				{activeTab === 'plans' && (
					<>
						<CloudCurrentPlanCard
							data={data}
							disabled={billingState.isPlanSelectionPending}
							onKeepPlan={() => void billingState.keepPlan()}
							onCancelPendingChange={() => void billingState.cancelPendingPlanChange()}
						/>
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
								data.recommendation === 'team' || data.recommendation === 'unlimited'
									? data.recommendation
									: null
							}
							disabled={
								billingState.isPlanSelectionPending ||
								data.scheduleConflict ||
								(data.access.tier !== 'trial' && data.cancellationScheduled)
							}
							onIntervalChange={billingState.setSelectedBillingInterval}
							onChoose={(plan) => {
								if (plan.tier === 'team') {
									setSelectedTeamPlan(plan);
									return;
								}
								void previewPlan(plan);
							}}
							onChooseFree={data.current ? () => setSwitchToFreeOpen(true) : undefined}
						/>
					</>
				)}
				{activeTab === 'seats' && (
					<>
						{data.access.tier === 'team' && data.access.seatQuantity === null && (
							<Callout role='alert'>
								Team seat quantity is unavailable. Refresh billing details before changing membership.
							</Callout>
						)}
						<CloudBillingSeatsCard
							tier={data.access.tier}
							seatQuantity={data.access.seatQuantity}
							seatLimit={data.access.seatLimit}
							availableSeats={data.access.availableSeats}
							candidates={data.seatCandidates}
							disabled={billingState.isBillingCommandPending || data.scheduleConflict}
							onPreviewSeatChange={
								data.access.tier === 'team' ? billingState.previewSeatChange : undefined
							}
							onConfirmSeatChange={billingState.confirmSeatChange}
							onSaveSeatSelection={
								data.access.tier === 'unlimited' || data.access.tier === 'bypass'
									? undefined
									: billingState.saveSeatSelection
							}
						/>
					</>
				)}
				{activeTab === 'credits' && (
					<section className='flex flex-col gap-4'>
						<div>
							<h2 className='text-base font-semibold text-foreground'>Organization credits</h2>
							<p className='text-sm text-muted-foreground'>
								Fund and review the shared nao AI wallet for this organization.
							</p>
						</div>
						<OrganizationCreditsContent
							creditCheckout={search.creditCheckout}
							canViewReplay={canViewChatReplay}
							activeTab={search.creditsTab ?? 'history'}
							onTabChange={onCreditsTabChange}
						/>
					</section>
				)}
				{activeTab === 'invoices' && (
					<div className='flex flex-col gap-12'>
						<InvoicesCard billingState={billingState} />
						<BillingManagementCard billingState={billingState} />
					</div>
				)}
			</div>
			<CloudBillingChangeDialog
				open={changePreview !== null}
				onOpenChange={(open) => !open && setChangePreview(null)}
				title={changeTitle}
				preview={changePreview}
				onRefresh={async () => setChangePreview(await refreshPreview())}
				onConfirm={async (token) => {
					await billingState.confirmPlanChange(token);
					setChangePreview(null);
				}}
				onFixPayment={billingState.openPaymentMethodPortal}
			/>
			<CloudBillingTeamSeatsDialog
				open={selectedTeamPlan !== null}
				plan={selectedTeamPlan}
				seatUserCount={data.access.seatUserCount}
				trialing={data.access.tier === 'trial'}
				redirectsToCheckout={!data.current}
				disabled={billingState.isPlanSelectionPending}
				onOpenChange={(open) => !open && setSelectedTeamPlan(null)}
				onConfirm={previewPlan}
			/>
			<CloudBillingSwitchToFreeDialog
				open={switchToFreeOpen}
				onOpenChange={setSwitchToFreeOpen}
				effectiveAt={currentPlanEndsAt}
				candidates={data.seatCandidates}
				trialing={data.access.tier === 'trial'}
				onConfirm={billingState.switchToFree}
			/>
		</SettingsPageWrapper>
	);
}

const billingTabs: Array<{ label: string; value: OrganizationBillingTab }> = [
	{ label: 'Plans', value: 'plans' },
	{ label: 'Seats', value: 'seats' },
	{ label: 'Credits', value: 'credits' },
	{ label: 'Invoices & payment', value: 'invoices' },
];

function BillingTabs({
	activeTab,
	showSeats,
	onTabChange,
}: {
	activeTab: OrganizationBillingTab;
	showSeats: boolean;
	onTabChange?: (tab: OrganizationBillingTab) => void;
}) {
	return (
		<div className='overflow-x-auto border-b border-border'>
			<div className='flex min-w-max gap-6' role='tablist' aria-label='Billing sections'>
				{billingTabs
					.filter((tab) => showSeats || tab.value !== 'seats')
					.map((tab) => (
						<button
							key={tab.value}
							type='button'
							role='tab'
							aria-selected={activeTab === tab.value}
							className={cn(
								'cursor-pointer border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
								activeTab === tab.value
									? 'border-primary text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground',
							)}
							onClick={() => onTabChange?.(tab.value)}
						>
							{tab.label}
						</button>
					))}
			</div>
		</div>
	);
}

function getActiveBillingTab(search: OrganizationBillingSearch, seatsAvailable: boolean): OrganizationBillingTab {
	const requestedTab =
		search.tab ??
		(search.creditCheckout || search.creditsTab ? 'credits' : search.portal === 'returned' ? 'invoices' : 'plans');
	return requestedTab === 'seats' && !seatsAvailable ? 'plans' : requestedTab;
}

function CloudCurrentPlanCard({
	data,
	disabled,
	onKeepPlan,
	onCancelPendingChange,
}: {
	data: CloudBillingData;
	disabled: boolean;
	onKeepPlan: () => void;
	onCancelPendingChange: () => void;
}) {
	const tier = data.access.tier;
	const trialing = tier === 'trial';
	const trialEndsAt = data.access.trialEndsAt ?? data.trialEndsAt;
	const planName =
		tier === 'trial'
			? 'Free trial'
			: tier === 'team'
				? 'Team'
				: tier === 'unlimited' || tier === 'bypass'
					? 'Unlimited'
					: 'Free';
	const description =
		tier === 'trial'
			? 'Full nao Cloud access for everyone while you try nao.'
			: tier === 'team'
				? `${data.access.seatQuantity ?? data.access.seatLimit ?? '—'} seats for people who need full access. Viewers are free.`
				: tier === 'unlimited' || tier === 'bypass'
					? 'Full access for everyone in your organization.'
					: `${data.access.seatLimit ?? 3} full-access seats and unlimited viewers.`;
	const keyDate = trialing
		? { label: 'Trial ends', value: trialEndsAt }
		: data.cancellationScheduled
			? { label: 'Paid plan ends', value: data.currentPeriodEndsAt }
			: data.pending
				? { label: 'Plan changes', value: data.currentPeriodEndsAt }
				: { label: 'Renews', value: data.currentPeriodEndsAt };
	const nextStep = getCloudNextStep(data, onKeepPlan, onCancelPendingChange);

	return (
		<SettingsCard title='Current plan'>
			<div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
				<div>
					<p className='text-2xl font-semibold text-foreground'>{planName}</p>
					<p className='mt-1 text-sm text-muted-foreground'>{description}</p>
					{data.current?.legacy && (
						<p className='mt-1 text-xs text-muted-foreground'>
							Legacy Unlimited keeps its existing price and terms.
						</p>
					)}
				</div>
				{tier !== 'free' && keyDate.value && (
					<div className='shrink-0 rounded-lg bg-muted/60 px-3 py-2 sm:text-right'>
						<p className='text-xs text-muted-foreground'>{keyDate.label}</p>
						<p className='text-sm font-medium text-foreground'>{formatBillingDate(keyDate.value)}</p>
					</div>
				)}
			</div>
			{nextStep && (
				<div className='flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between'>
					<div>
						<p className='text-sm font-medium text-foreground'>{nextStep.title}</p>
						<p className='mt-1 text-sm text-muted-foreground'>{nextStep.description}</p>
					</div>
					{nextStep.action && (
						<Button
							className='shrink-0'
							variant='secondary'
							size='sm'
							disabled={disabled}
							onClick={nextStep.action.onClick}
						>
							{nextStep.action.label}
						</Button>
					)}
				</div>
			)}
		</SettingsCard>
	);
}

function getCloudNextStep(
	data: CloudBillingData,
	onKeepPlan: () => void,
	onCancelPendingChange: () => void,
): { title: string; description: string; action?: { label: string; onClick: () => void } } | null {
	const trialing = data.access.tier === 'trial';
	const currentTierName = data.current?.tier === 'team' ? 'Team' : 'Unlimited';
	if (trialing && data.cancellationScheduled) {
		return {
			title: 'Free after your trial',
			description: 'Your organization moves to Free when the trial ends and keeps all of its data.',
			action: { label: 'Keep paid plan after trial', onClick: onKeepPlan },
		};
	}
	if (trialing && data.current) {
		return {
			title: `${currentTierName} starts after your trial`,
			description: `${data.current.interval === 'monthly' ? 'Monthly' : 'Yearly'} billing begins when the trial ends.`,
		};
	}
	if (trialing) {
		return {
			title: 'Free after your trial',
			description:
				'Choose Team or Unlimited below to keep full access for everyone. Otherwise your organization moves to Free and keeps all of its data.',
		};
	}
	if (data.cancellationScheduled) {
		return {
			title: 'Switching to Free',
			description: `Your current plan stays active through ${formatBillingDate(data.currentPeriodEndsAt)}. Nobody or their data is removed.`,
			action: { label: 'Keep my plan', onClick: onKeepPlan },
		};
	}
	if (data.pending) {
		return {
			title: `${data.pending.tier === 'team' ? 'Team' : 'Unlimited'} starts ${formatBillingDate(data.pending.effectiveAt)}`,
			description: 'Your current plan stays active until then.',
			action: { label: 'Cancel change', onClick: onCancelPendingChange },
		};
	}
	return null;
}

function BillingFeedback({ billingState }: { billingState: BillingState }) {
	if (!billingState.checkoutFeedback && !billingState.portalFeedback) {
		return null;
	}

	return (
		<div
			className='flex flex-col items-start gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground'
			role='status'
			aria-live='polite'
		>
			{billingState.checkoutFeedback && <p>{billingState.checkoutFeedback}</p>}
			{billingState.portalFeedback && <p>{billingState.portalFeedback}</p>}
			{billingState.isCheckoutConfirmationDelayed && (
				<Button variant='secondary' size='sm' onClick={billingState.retryCheckoutConfirmation}>
					Refresh status
				</Button>
			)}
		</div>
	);
}

function CurrentPlanCard({ billingState }: { billingState: BillingState }) {
	const {
		billing,
		hasStripeSubscription,
		isHistoricalSubscription,
		needsPaidPlanSelection,
		paidPlanSelected,
		statusView,
	} = billingState;
	const currentPlan = billing.data?.plan;
	const trialEndedWithoutPaidPlan =
		billing.data?.resubscribeAvailable === true &&
		!paidPlanSelected &&
		Boolean(billing.data.trialStartedAt || billing.data.trialEndsAt);

	return (
		<SettingsCard title='Current plan'>
			{billing.isLoading && (
				<p className='text-sm text-muted-foreground' role='status' aria-live='polite'>
					Loading billing details…
				</p>
			)}
			{billing.isError && (
				<p className='text-sm text-destructive' role='alert'>
					Unable to load billing details.
				</p>
			)}
			{billing.data &&
				(needsPaidPlanSelection ? (
					<div className='flex flex-col gap-2'>
						<div className='flex flex-wrap items-center gap-2'>
							<p className='font-medium text-foreground'>nao Cloud trial</p>
							<Badge variant={statusView.variant}>{statusView.label}</Badge>
						</div>
						<p className='text-sm text-muted-foreground'>{statusView.description}</p>
						<p className='text-sm text-muted-foreground'>
							Trial ends {formatBillingDate(billing.data.trialEndsAt)}.
						</p>
					</div>
				) : currentPlan && !isHistoricalSubscription ? (
					<div className='flex flex-col gap-2'>
						<div className='flex flex-wrap items-center gap-2'>
							<p className='font-medium text-foreground'>{currentPlan.name}</p>
							<Badge variant={statusView.variant}>{statusView.label}</Badge>
						</div>
						<p className='text-sm text-muted-foreground'>
							{formatBillingPrice(currentPlan.amount, currentPlan.currency)} per{' '}
							{formatBillingInterval(currentPlan.interval, currentPlan.intervalCount)}, before discounts
						</p>
						<p className='text-sm text-muted-foreground'>{statusView.description}</p>
						<UpcomingPaymentEstimate billingState={billingState} />
						{billingState.isEndingAtPeriodEnd && (
							<div className='mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2'>
								<p className='text-sm font-medium text-foreground'>Subscription will not renew</p>
								<p className='text-sm text-muted-foreground'>
									Your plan remains active through{' '}
									{formatBillingDate(
										billing.data.billingAccessEndsAt ?? billing.data.currentPeriodEndsAt,
									)}
									. It will end after that date.
								</p>
							</div>
						)}
					</div>
				) : (
					<div className='flex flex-col gap-2'>
						<div className='flex flex-wrap items-center gap-2'>
							<p className='font-medium text-foreground'>No active plan</p>
							{isHistoricalSubscription && <Badge variant={statusView.variant}>{statusView.label}</Badge>}
						</div>
						<p className='text-sm text-muted-foreground'>
							{trialEndedWithoutPaidPlan
								? 'Your free trial has ended. Subscribe to restore access.'
								: hasStripeSubscription
									? statusView.description
									: billing.data.trialAvailable
										? 'Start your free trial to unlock nao Cloud for this organization.'
										: 'Subscribe to nao Cloud to restore access.'}
						</p>
					</div>
				))}
		</SettingsCard>
	);
}

function UpcomingPaymentEstimate({ billingState }: { billingState: BillingState }) {
	if (!billingState.canLoadUpcomingInvoice) {
		return null;
	}
	const upcomingInvoice = billingState.upcomingInvoice;
	if (upcomingInvoice.isLoading) {
		return (
			<p className='text-sm text-muted-foreground' role='status'>
				Loading the next payment estimate from Stripe…
			</p>
		);
	}
	if (upcomingInvoice.isError) {
		return <p className='text-sm text-muted-foreground'>The next payment estimate is unavailable.</p>;
	}
	if (!upcomingInvoice.data) {
		return null;
	}

	return (
		<div className='mt-2 rounded-md border border-border bg-muted/40 px-3 py-2'>
			<p className='text-xs text-muted-foreground'>Next payment estimate from Stripe</p>
			<div className='mt-1 flex flex-wrap items-center gap-2'>
				<p className='font-medium text-foreground'>
					{formatBillingPrice(upcomingInvoice.data.amountDue, upcomingInvoice.data.currency)} on{' '}
					{formatBillingDate(upcomingInvoice.data.nextPaymentAt)}
				</p>
				{upcomingInvoice.data.promotionCodes.map((code) => (
					<Badge key={code} variant='outline'>
						Code {code}
					</Badge>
				))}
			</div>
			<p className='mt-1 text-xs text-muted-foreground'>
				Stripe includes active promotions, credits, and estimated taxes. The final amount can change before
				billing.
			</p>
		</div>
	);
}

function BillingSetupCard({ billingState }: { billingState: BillingState }) {
	const { billing, needsPaidPlanSelection, paidPlanSelected, plan } = billingState;
	const trialCheckoutAvailable = billing.data?.trialAvailable === true || needsPaidPlanSelection;
	if (!billing.data || paidPlanSelected || !plan || (!trialCheckoutAvailable && !billing.data.resubscribeAvailable)) {
		return null;
	}
	const isTrialAvailable = billing.data.trialAvailable;
	const wasTrialUsed = Boolean(billing.data.trialStartedAt || billing.data.trialEndsAt);

	return (
		<SettingsCard title='Billing setup'>
			<div className='flex flex-col gap-5'>
				<BillingIntervalSelector billingState={billingState} />
				<div>
					<div className='mb-1 text-sm font-medium text-foreground'>{plan.name}</div>
					<div className='text-2xl font-semibold text-foreground'>
						{formatBillingPrice(plan.amount, plan.currency)}
					</div>
					<div className='text-sm text-muted-foreground'>
						per {formatBillingInterval(plan.interval, plan.intervalCount)}, before discounts
					</div>
				</div>

				<dl className='grid gap-3 text-sm sm:grid-cols-2'>
					<PlanDetail label='Users' value={plan.userLimit === null ? 'Unlimited' : String(plan.userLimit)} />
					<PlanDetail
						label='Billing period'
						value={`Every ${formatBillingInterval(plan.interval, plan.intervalCount)}`}
					/>
					<PlanDetail
						label='Free trial'
						value={
							needsPaidPlanSelection
								? `Ends ${formatBillingDate(billing.data.trialEndsAt)}`
								: isTrialAvailable
									? `${plan.trialDays} days, starting after Stripe Checkout`
									: wasTrialUsed
										? 'Already used'
										: 'Unavailable'
						}
					/>
					{trialCheckoutAvailable && <PlanDetail label='Due today' value='No charge' />}
				</dl>

				<div className='flex flex-col items-start gap-3 border-t border-border pt-5'>
					<p className='text-sm text-muted-foreground'>
						{needsPaidPlanSelection
							? `Your trial is already active through ${formatBillingDate(billing.data.trialEndsAt)}. Choose monthly or yearly billing in Stripe, where you can enter a promotion code. Nothing is charged before the trial ends.`
							: isTrialAvailable
								? `Continue to Stripe to choose monthly or yearly billing, add a card, and start this organization's ${plan.trialDays}-day free trial. Nothing is charged today. Stripe applies promotion codes to the recurring price, which starts after the trial.`
								: 'Continue to Stripe to restore billing for this organization. Billing starts immediately.'}
					</p>
					<p className='text-xs text-muted-foreground'>
						To create your organization&apos;s Stripe billing profile, nao shares an organization
						admin&apos;s email address with Stripe.{' '}
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
					{billing.data.canManageBilling ? (
						<Button
							onClick={trialCheckoutAvailable ? billingState.openTrialCheckout : billingState.resubscribe}
							isLoading={
								trialCheckoutAvailable
									? billingState.isTrialCheckoutPending
									: billingState.isResubscribePending
							}
							disabled={billingState.isCheckoutPolling}
						>
							{needsPaidPlanSelection
								? 'Choose plan in Stripe'
								: isTrialAvailable
									? 'Start your free trial in Stripe'
									: 'Subscribe in Stripe'}
						</Button>
					) : (
						<p className='text-sm text-muted-foreground'>
							Only an organization admin can subscribe or add billing details.
						</p>
					)}
					{(trialCheckoutAvailable ? billingState.trialCheckoutError : billingState.managementError) && (
						<p className='text-sm text-destructive' role='alert'>
							{trialCheckoutAvailable ? billingState.trialCheckoutError : billingState.managementError}
						</p>
					)}
				</div>
			</div>
		</SettingsCard>
	);
}

function BillingIntervalSelector({ billingState }: { billingState: BillingState }) {
	const plans = billingState.billing.data?.availablePlans;
	if (!plans) {
		return null;
	}
	const yearlySavings = 1 - plans.yearly.amount / (plans.monthly.amount * 12);
	const yearlyMonthlyEquivalent = plans.yearly.amount / 12;
	const yearlyDiscount =
		yearlySavings > 0
			? `${new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(yearlySavings)} off`
			: undefined;

	return (
		<div className='grid gap-3 sm:grid-cols-2' role='group' aria-label='Billing interval'>
			<BillingIntervalOption
				billingInterval='monthly'
				billingState={billingState}
				title='Monthly'
				price={`${formatBillingPrice(plans.monthly.amount, plans.monthly.currency)} per month`}
				description='Billed monthly'
			/>
			<BillingIntervalOption
				billingInterval='yearly'
				billingState={billingState}
				title='Yearly'
				badge={yearlyDiscount}
				price={`${formatBillingPrice(plans.yearly.amount, plans.yearly.currency)} per year`}
				description={`${formatBillingPrice(yearlyMonthlyEquivalent, plans.yearly.currency)} per month equivalent`}
			/>
		</div>
	);
}

function BillingIntervalOption({
	billingInterval,
	billingState,
	badge,
	title,
	price,
	description,
}: {
	billingInterval: BillingInterval;
	billingState: BillingState;
	badge?: string;
	title: string;
	price: string;
	description: string;
}) {
	const selected = billingState.selectedBillingInterval === billingInterval;
	return (
		<button
			type='button'
			aria-pressed={selected}
			className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed ${
				selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
			}`}
			onClick={() => {
				billingState.setSelectedBillingInterval(billingInterval);
			}}
			disabled={
				billingState.isCheckoutPolling ||
				billingState.isTrialCheckoutPending ||
				billingState.isResubscribePending
			}
		>
			<span className='flex items-center gap-2 font-medium text-foreground'>
				{title}
				{badge && <Badge>{badge}</Badge>}
			</span>
			<span className='text-sm text-foreground'>{price}</span>
			<span className='text-xs text-muted-foreground'>{description}</span>
		</button>
	);
}

function PlanDetailsCard({ billingState }: { billingState: BillingState }) {
	const { billing, isHistoricalSubscription, paidPlanSelected, plan, status } = billingState;
	if (!billing.data || !paidPlanSelected) {
		return null;
	}
	if (billingState.isEndingAtPeriodEnd) {
		return null;
	}

	return (
		<SettingsCard title={isHistoricalSubscription ? 'Subscription history' : 'Subscription details'}>
			{isHistoricalSubscription && plan && (
				<div className='mb-5 flex flex-col gap-1'>
					<p className='font-medium text-foreground'>{plan.name}</p>
					<p className='text-sm text-muted-foreground'>
						{formatBillingPrice(plan.amount, plan.currency)} per{' '}
						{formatBillingInterval(plan.interval, plan.intervalCount)} · kept for billing history
					</p>
				</div>
			)}
			<dl className='grid gap-3 text-sm sm:grid-cols-2'>
				{status === 'trialing' ? (
					<PlanDetail label='Trial ends' value={formatBillingDate(billing.data.trialEndsAt)} />
				) : isHistoricalSubscription ? (
					<PlanDetail
						label='Access ended'
						value={formatBillingDate(billing.data.billingAccessEndsAt ?? billing.data.currentPeriodEndsAt)}
					/>
				) : (
					<PlanDetail
						label={status === 'active' ? 'Next renewal' : 'Billing period ends'}
						value={formatBillingDate(billing.data.currentPeriodEndsAt)}
					/>
				)}
			</dl>
		</SettingsCard>
	);
}

function InvoicesCard({ billingState }: { billingState: BillingState }) {
	const { billing, invoices } = billingState;
	if (!billing.data?.invoiceHistoryAvailable) {
		return null;
	}

	return (
		<SettingsCard title='Invoices'>
			{!billing.data.canManageBilling ? (
				<p className='text-sm text-muted-foreground'>Only an organization admin can view invoices.</p>
			) : invoices.isLoading ? (
				<p className='text-sm text-muted-foreground' role='status' aria-live='polite'>
					Loading invoices…
				</p>
			) : invoices.isError ? (
				<p className='text-sm text-destructive' role='alert'>
					Unable to load invoices.
				</p>
			) : invoices.data?.length ? (
				<div className='flex flex-col divide-y divide-border'>
					{invoices.data.map((invoice) => (
						<div
							key={invoice.id}
							className='flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between'
						>
							<div>
								<div className='flex items-center gap-2'>
									<p className='font-medium text-foreground'>
										{formatInvoiceLabel(invoice.createdAt)}
									</p>
									<Badge variant='secondary'>
										{invoice.invoiceKind === 'trial'
											? 'Trial'
											: invoice.invoiceKind === 'no_charge'
												? 'No charge'
												: invoice.invoiceKind === 'credit_top_up'
													? 'Nao credits'
													: 'Subscription'}
									</Badge>
									{invoice.invoiceKind === 'subscription' &&
										invoice.promotionCodes.map((code) => (
											<Badge key={code} variant='outline'>
												Code {code}
											</Badge>
										))}
								</div>
								<p className='text-sm text-muted-foreground'>
									{invoice.invoiceKind === 'trial'
										? `${formatBillingDate(invoice.createdAt)} · No charge during trial`
										: invoice.invoiceKind === 'no_charge'
											? `${formatBillingDate(invoice.createdAt)} · No charge`
											: `${formatBillingDate(invoice.createdAt)} · ${formatBillingPrice(invoice.total, invoice.currency)} · ${formatBillingStatus(invoice.status)}`}
								</p>
								{invoice.number && <p className='text-xs text-muted-foreground'>{invoice.number}</p>}
							</div>
							<div className='flex flex-wrap gap-2'>
								{invoice.hostedInvoiceUrl && (
									<Button variant='secondary' size='sm' asChild>
										<a href={invoice.hostedInvoiceUrl} target='_blank' rel='noreferrer'>
											View invoice
										</a>
									</Button>
								)}
								{invoice.invoicePdf && (
									<Button variant='secondary' size='sm' asChild>
										<a href={invoice.invoicePdf} target='_blank' rel='noreferrer'>
											Download PDF
										</a>
									</Button>
								)}
							</div>
						</div>
					))}
				</div>
			) : (
				<p className='text-sm text-muted-foreground'>No invoices yet.</p>
			)}
		</SettingsCard>
	);
}

function BillingManagementCard({ billingState }: { billingState: BillingState }) {
	const { billing, paidPlanSelected, status } = billingState;
	if (!billing.data || !paidPlanSelected) {
		return null;
	}

	const hasManagementAction =
		billing.data.portalAvailable ||
		billing.data.paymentMethodManagementAvailable ||
		billing.data.resubscribeAvailable;

	return (
		<SettingsCard title='Billing management'>
			{billing.data.canManageBilling ? (
				<div className='flex flex-col items-start gap-3'>
					{hasManagementAction ? (
						<>
							<p className='text-sm text-muted-foreground'>
								{getBillingManagementDescription(status, billing.data.hasDefaultPaymentMethod === true)}
							</p>
							{billing.data.resubscribeAvailable && (
								<div className='w-full'>
									<BillingIntervalSelector billingState={billingState} />
								</div>
							)}
							<div className='flex flex-wrap gap-2'>
								{billing.data.resubscribeAvailable && (
									<Button
										onClick={billingState.resubscribe}
										isLoading={billingState.isResubscribePending}
										disabled={billingState.isCheckoutPolling}
									>
										Start new subscription
									</Button>
								)}
								{billing.data.paymentMethodManagementAvailable && (
									<Button
										variant={billing.data.resubscribeAvailable ? 'secondary' : 'default'}
										onClick={billingState.openPaymentMethodPortal}
										isLoading={billingState.isPaymentMethodPortalPending}
									>
										Manage payment method
									</Button>
								)}
								{billing.data.portalAvailable && (
									<Button
										variant='secondary'
										onClick={billingState.openPortal}
										isLoading={billingState.isPortalPending}
									>
										{getBillingPortalButtonLabel(status)}
									</Button>
								)}
								{status === 'paused' && (
									<Button
										variant='secondary'
										onClick={billingState.resume}
										isLoading={billingState.isResumePending}
									>
										Resume subscription
									</Button>
								)}
								<Button
									variant='secondary'
									onClick={billingState.syncBilling}
									isLoading={billingState.isBillingSyncPending}
								>
									Refresh billing details
								</Button>
							</div>
							{status === 'trialing' && (
								<p className='text-xs text-muted-foreground'>
									Without a payment method, Stripe pauses the subscription when the trial ends.
								</p>
							)}
						</>
					) : (
						<p className='text-sm text-muted-foreground'>
							Billing management is not available for this subscription.
						</p>
					)}
					{billingState.managementError && (
						<p className='text-sm text-destructive' role='alert'>
							{billingState.managementError}
						</p>
					)}
				</div>
			) : (
				<p className='text-sm text-muted-foreground'>Only an organization admin can manage billing.</p>
			)}
		</SettingsCard>
	);
}

function SubscriptionRecoveryCard({ billingState }: { billingState: BillingState }) {
	const { billing, paidPlanSelected } = billingState;
	if (!billing.data || !paidPlanSelected || !billing.data.resubscribeAvailable) {
		return null;
	}

	return (
		<SettingsCard title='Start a new subscription'>
			<div className='flex flex-col items-start gap-3'>
				<p className='text-sm text-muted-foreground'>
					Choose a billing interval to start a new subscription for this organization.
				</p>
				<div className='w-full'>
					<BillingIntervalSelector billingState={billingState} />
				</div>
				<Button
					onClick={billingState.resubscribe}
					isLoading={billingState.isResubscribePending}
					disabled={billingState.isCheckoutPolling}
				>
					Start new subscription
				</Button>
				{billingState.managementError && (
					<p className='text-sm text-destructive' role='alert'>
						{billingState.managementError}
					</p>
				)}
			</div>
		</SettingsCard>
	);
}

function PlanDetail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className='text-xs text-muted-foreground'>{label}</dt>
			<dd className='font-medium text-foreground'>{value}</dd>
		</div>
	);
}
