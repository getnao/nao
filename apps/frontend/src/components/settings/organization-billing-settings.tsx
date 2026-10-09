import type { BillingInterval, OrganizationBillingSearch } from '@/hooks/use-organization-billing';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { useOrganizationBilling } from '@/hooks/use-organization-billing';
import {
	formatBillingDate,
	formatBillingInterval,
	formatBillingPrice,
	formatBillingStatus,
	formatInvoiceLabel,
	getBillingManagementDescription,
	getBillingPortalButtonLabel,
} from '@/lib/billing-display';

type BillingState = ReturnType<typeof useOrganizationBilling>;

export function OrganizationBillingSettings({ search }: { search: OrganizationBillingSearch }) {
	const billingState = useOrganizationBilling(search);

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Plan & Billing</h1>
					<p className='text-sm text-muted-foreground'>
						Review your current plan, subscription history, invoices, and billing actions.
					</p>
				</div>

				<BillingFeedback billingState={billingState} />

				<div className='flex flex-col gap-12'>
					<CurrentPlanCard billingState={billingState} />
					<BillingSetupCard billingState={billingState} />
					<PlanDetailsCard billingState={billingState} />
					<InvoicesCard billingState={billingState} />
					<BillingManagementCard billingState={billingState} />
				</div>
			</div>
		</SettingsPageWrapper>
	);
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
	const { billing, hasStripeSubscription, isHistoricalSubscription, statusView } = billingState;
	const currentPlan = billing.data?.plan;

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
				(currentPlan && !isHistoricalSubscription ? (
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
							{hasStripeSubscription
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
	const { billing, hasStripeSubscription, plan } = billingState;
	if (
		!billing.data ||
		hasStripeSubscription ||
		!plan ||
		(!billing.data.trialAvailable && !billing.data.resubscribeAvailable)
	) {
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
							isTrialAvailable
								? `${plan.trialDays} days, starting after Stripe Checkout`
								: wasTrialUsed
									? 'Already used'
									: 'Unavailable'
						}
					/>
					{isTrialAvailable && <PlanDetail label='Due today' value='No charge' />}
				</dl>

				<div className='flex flex-col items-start gap-3 border-t border-border pt-5'>
					<p className='text-sm text-muted-foreground'>
						{isTrialAvailable
							? `Continue to Stripe to add a card and confirm this organization's ${plan.trialDays}-day free trial. Nothing is charged today. Stripe applies promotion codes to the recurring price, which starts after the trial.`
							: 'Continue to Stripe to restore billing for this organization. Billing starts immediately.'}
					</p>
					{billing.data.canManageBilling ? (
						<Button
							onClick={isTrialAvailable ? billingState.openTrialCheckout : billingState.resubscribe}
							isLoading={
								isTrialAvailable
									? billingState.isTrialCheckoutPending
									: billingState.isResubscribePending
							}
							disabled={billingState.isCheckoutPolling}
						>
							{isTrialAvailable
								? `Start ${plan.trialDays}-day free trial in Stripe`
								: 'Subscribe in Stripe'}
						</Button>
					) : (
						<p className='text-sm text-muted-foreground'>
							Only an organization admin can subscribe or add billing details.
						</p>
					)}
					{(isTrialAvailable ? billingState.trialCheckoutError : billingState.managementError) && (
						<p className='text-sm text-destructive' role='alert'>
							{isTrialAvailable ? billingState.trialCheckoutError : billingState.managementError}
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
	const { billing, hasStripeSubscription, isHistoricalSubscription, plan, status } = billingState;
	if (!billing.data || !hasStripeSubscription) {
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
	const { billing, hasStripeSubscription, status } = billingState;
	if (!billing.data || !hasStripeSubscription) {
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

function PlanDetail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className='text-xs text-muted-foreground'>{label}</dt>
			<dd className='font-medium text-foreground'>{value}</dd>
		</div>
	);
}
