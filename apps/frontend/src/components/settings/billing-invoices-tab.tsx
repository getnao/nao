import { RefreshCwIcon } from 'lucide-react';

import type { OrganizationBillingState } from '@/hooks/use-organization-billing';
import { LegacyBillingIntervalSelector } from '@/components/settings/legacy-billing-plans-tab';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import {
	formatBillingDate,
	formatBillingPrice,
	formatBillingStatus,
	formatInvoiceLabel,
	getBillingManagementDescription,
} from '@/lib/billing-display';

export function BillingInvoicesTab({ billingState }: { billingState: OrganizationBillingState }) {
	return (
		<div className='flex flex-col gap-12'>
			<InvoicesCard billingState={billingState} />
			<BillingManagementCard billingState={billingState} />
		</div>
	);
}

function InvoicesCard({ billingState }: { billingState: OrganizationBillingState }) {
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
													: invoice.planTier === 'team'
														? 'Team'
														: invoice.planTier === 'unlimited'
															? 'Unlimited'
															: 'Subscription'}
									</Badge>
									{invoice.invoiceKind === 'subscription' &&
										invoice.promotionCodes.map((code) => (
											<Badge key={code} variant='outline'>
												{code}
											</Badge>
										))}
								</div>
								<p className='text-sm text-muted-foreground'>
									{invoice.invoiceKind === 'trial'
										? `${formatBillingDate(invoice.createdAt)} · $0 charged during trial`
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
											{invoice.status === 'open' ? 'Complete payment' : 'View invoice'}
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

function BillingManagementCard({ billingState }: { billingState: OrganizationBillingState }) {
	const { billing, paidPlanSelected, status } = billingState;
	if (!billing.data || !paidPlanSelected) {
		return null;
	}

	const shouldResume = status === 'paused' && billing.data.hasDefaultPaymentMethod === true;
	const canOpenPortal = billing.data.portalAvailable || billing.data.paymentMethodManagementAvailable;
	const legacyResubscribeAvailable = billing.data.resubscribeAvailable && !('access' in billing.data);
	const hasManagementAction = legacyResubscribeAvailable || shouldResume || canOpenPortal;

	return (
		<SettingsCard title='Billing management'>
			{billing.data.canManageBilling ? (
				<div className='flex flex-col items-start gap-3'>
					{hasManagementAction ? (
						<>
							<p className='text-sm text-muted-foreground'>
								{getBillingManagementDescription(status, billing.data.hasDefaultPaymentMethod === true)}
							</p>
							{legacyResubscribeAvailable && (
								<div className='w-full'>
									<LegacyBillingIntervalSelector billingState={billingState} />
								</div>
							)}
							<div className='flex flex-wrap gap-2'>
								{legacyResubscribeAvailable && (
									<Button
										onClick={billingState.resubscribe}
										isLoading={billingState.isResubscribePending}
										disabled={billingState.isCheckoutPolling}
									>
										Start new subscription
									</Button>
								)}
								{!legacyResubscribeAvailable && shouldResume && (
									<Button onClick={billingState.resume} isLoading={billingState.isResumePending}>
										Resume subscription
									</Button>
								)}
								{!legacyResubscribeAvailable && !shouldResume && canOpenPortal && (
									<Button
										onClick={
											billing.data.portalAvailable
												? billingState.openPortal
												: billingState.openPaymentMethodPortal
										}
										isLoading={
											billingState.isPortalPending || billingState.isPaymentMethodPortalPending
										}
									>
										Manage billing in Stripe
									</Button>
								)}
								<Button
									variant='secondary'
									size='icon'
									onClick={billingState.syncBilling}
									isLoading={billingState.isBillingSyncPending}
									aria-label='Refresh billing details'
									title='Refresh billing details'
								>
									{!billingState.isBillingSyncPending && <RefreshCwIcon />}
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
