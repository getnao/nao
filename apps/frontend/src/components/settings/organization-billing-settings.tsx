import type { OrganizationBillingSearch } from '@/hooks/use-organization-billing';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { useOrganizationBilling } from '@/hooks/use-organization-billing';
import {
	formatBillingDate,
	formatBillingInterval,
	formatBillingPrice,
	formatBillingRenewal,
	formatBillingStatus,
	getBillingManagementDescription,
	getBillingPortalButtonLabel,
	preservesRemainingTrial,
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
	const { billing, hasStripeSubscription, isHistoricalSubscription, plan, statusView } = billingState;

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
				(plan && !isHistoricalSubscription ? (
					<div className='flex flex-col gap-2'>
						<div className='flex flex-wrap items-center gap-2'>
							<p className='font-medium text-foreground'>{plan.name}</p>
							<Badge variant={statusView.variant}>{statusView.label}</Badge>
						</div>
						<p className='text-sm text-muted-foreground'>
							{formatBillingPrice(plan.amount, plan.currency)} per{' '}
							{formatBillingInterval(plan.interval, plan.intervalCount)}
						</p>
						<p className='text-sm text-muted-foreground'>{statusView.description}</p>
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
								: 'Subscribe to nao Cloud to restore access.'}
						</p>
					</div>
				))}
		</SettingsCard>
	);
}

function BillingSetupCard({ billingState }: { billingState: BillingState }) {
	const { billing, hasStripeSubscription, plan } = billingState;
	if (!billing.data || hasStripeSubscription || !plan) {
		return null;
	}

	const isLocalTrialActive = billing.data.localTrialActive;
	const subscribeDescription = !isLocalTrialActive
		? 'Your free trial has ended. Subscribe to restore access; billing starts immediately.'
		: preservesRemainingTrial(billing.data.trialEndsAt)
			? 'Your free trial is already active. Subscribe now to preserve the remaining trial time; billing starts when it ends.'
			: 'Less than 48 hours remain on your free trial. Subscribe now and billing starts immediately.';

	return (
		<SettingsCard title='Billing setup'>
			<div className='flex flex-col gap-5'>
				<div>
					<div className='mb-1 text-sm font-medium text-foreground'>{plan.name}</div>
					<div className='text-2xl font-semibold text-foreground'>
						{formatBillingPrice(plan.amount, plan.currency)}
					</div>
					<div className='text-sm text-muted-foreground'>
						per {formatBillingInterval(plan.interval, plan.intervalCount)}
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
							isLocalTrialActive
								? `Active until ${formatBillingDate(billing.data.trialEndsAt)}`
								: `Ended ${formatBillingDate(billing.data.trialEndsAt)}`
						}
					/>
					<PlanDetail label='Currency' value={plan.currency.toUpperCase()} />
				</dl>

				<div className='flex flex-col items-start gap-3 border-t border-border pt-5'>
					<p className='text-sm text-muted-foreground'>{subscribeDescription}</p>
					{billing.data.canManageBilling ? (
						<Button onClick={billingState.subscribe} isLoading={billingState.isCheckoutPending}>
							Subscribe to nao Cloud
						</Button>
					) : (
						<p className='text-sm text-muted-foreground'>
							Only an organization admin can subscribe or add billing details.
						</p>
					)}
					{billingState.checkoutError && (
						<p className='text-sm text-destructive' role='alert'>
							{billingState.checkoutError}
						</p>
					)}
				</div>
			</div>
		</SettingsCard>
	);
}

function PlanDetailsCard({ billingState }: { billingState: BillingState }) {
	const { billing, hasStripeSubscription, isHistoricalSubscription, plan, status, statusView } = billingState;
	if (!billing.data || (!hasStripeSubscription && status !== 'trialing')) {
		return null;
	}

	return (
		<SettingsCard
			title={
				isHistoricalSubscription
					? 'Subscription history'
					: hasStripeSubscription
						? 'Subscription details'
						: 'Trial details'
			}
		>
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
				<PlanDetail label='Status' value={statusView.label} />
				<PlanDetail label='Trial started' value={formatBillingDate(billing.data.trialStartedAt)} />
				<PlanDetail
					label={status === 'trialing' && !billingState.isLocalTrialExpired ? 'Trial ends' : 'Trial ended'}
					value={formatBillingDate(billing.data.trialEndsAt)}
				/>
				{hasStripeSubscription && (
					<>
						<PlanDetail
							label='Current period ends'
							value={formatBillingDate(billing.data.currentPeriodEndsAt)}
						/>
						<PlanDetail
							label='Renewal'
							value={formatBillingRenewal(status, billing.data.cancelAtPeriodEnd ?? false)}
						/>
						<PlanDetail
							label='Payment method'
							value={billing.data.hasDefaultPaymentMethod ? 'On file' : 'Not added'}
						/>
					</>
				)}
				<PlanDetail label='Access through' value={formatBillingDate(billing.data.billingAccessEndsAt)} />
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
								<p className='font-medium text-foreground'>{invoice.number ?? 'Invoice'}</p>
								<p className='text-sm text-muted-foreground'>
									{formatBillingDate(invoice.createdAt)} ·{' '}
									{formatBillingPrice(invoice.total, invoice.currency)} ·{' '}
									{formatBillingStatus(invoice.status)}
								</p>
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
