import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireCloudBilling } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/billing')({
	beforeLoad: requireCloudBilling,
	validateSearch: (search: Record<string, unknown>) => ({
		checkout:
			search.checkout === 'success' || search.checkout === 'subscribed' || search.checkout === 'canceled'
				? search.checkout
				: undefined,
		portal: search.portal === 'returned' ? search.portal : undefined,
	}),
	staticData: {
		title: 'Plan & Billing',
	},
	component: PlanAndBillingPage,
});

function PlanAndBillingPage() {
	const search = Route.useSearch();
	const [isResumeConfirming, setIsResumeConfirming] = useState(false);
	const [isCheckoutPolling, setIsCheckoutPolling] = useState(
		search.checkout === 'success' || search.checkout === 'subscribed',
	);
	const billing = useQuery({
		...trpc.billing.getStatus.queryOptions(),
		refetchInterval: (query) =>
			(isCheckoutPolling &&
				(search.checkout === 'subscribed'
					? isTerminalStatus(query.state.data?.status)
					: !query.state.data?.subscriptionConfirmed)) ||
			(query.state.data?.status === 'paused' && isResumeConfirming)
				? 2_000
				: false,
	});
	const invoices = useQuery({
		...trpc.billing.getInvoices.queryOptions(),
		enabled: billing.data?.canManageBilling === true && billing.data.invoiceHistoryAvailable,
	});
	const plan = billing.data?.plan ?? billing.data?.availablePlan;
	const checkout = useMutation(
		trpc.billing.createCheckoutSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);
	const portal = useMutation(
		trpc.billing.createPortalSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);
	const paymentMethodPortal = useMutation(
		trpc.billing.createPaymentMethodSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);
	const resubscribe = useMutation(
		trpc.billing.createResubscribeSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);
	const resumeSubscription = useMutation(
		trpc.billing.resumeSubscription.mutationOptions({
			onSuccess: () => {
				setIsResumeConfirming(true);
				void billing.refetch();
			},
		}),
	);
	const isConfirmingTrial = search.checkout === 'success' && !billing.data?.subscriptionConfirmed;
	const hasSubscription = billing.data?.subscriptionConfirmed === true;
	const status = billing.data?.status ?? null;
	const isHistoricalSubscription = status === 'canceled' || status === 'incomplete_expired';
	const isConfirmingSubscription = search.checkout === 'subscribed' && isHistoricalSubscription;
	const isCheckoutConfirmed =
		search.checkout === 'subscribed' ? hasSubscription && !isHistoricalSubscription : hasSubscription;
	const statusView = getStatusView(status, billing.data?.cancelAtPeriodEnd ?? false);
	const isEndingAtPeriodEnd =
		billing.data?.cancelAtPeriodEnd === true && (status === 'active' || status === 'trialing');

	useEffect(() => {
		if (!isCheckoutPolling || isCheckoutConfirmed) {
			return;
		}
		const timeout = window.setTimeout(() => setIsCheckoutPolling(false), 15_000);
		return () => window.clearTimeout(timeout);
	}, [isCheckoutConfirmed, isCheckoutPolling]);

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Plan & Billing</h1>
					<p className='text-sm text-muted-foreground'>
						Review your current plan, subscription history, invoices, and billing actions.
					</p>
				</div>

				<div className='flex flex-col gap-12'>
					<SettingsCard title='Current plan'>
						{billing.isLoading && <p className='text-sm text-muted-foreground'>Loading billing details…</p>}
						{billing.isError && <p className='text-sm text-destructive'>Unable to load billing details.</p>}
						{billing.data &&
							(hasSubscription && !isHistoricalSubscription ? (
								plan ? (
									<div className='flex flex-col gap-2'>
										<div className='flex flex-wrap items-center gap-2'>
											<p className='font-medium text-foreground'>{plan.name}</p>
											<Badge variant={statusView.variant}>{statusView.label}</Badge>
										</div>
										<p className='text-sm text-muted-foreground'>
											{formatPrice(plan.amount, plan.currency)} per{' '}
											{formatInterval(plan.interval, plan.intervalCount)}
										</p>
										<p className='text-sm text-muted-foreground'>{statusView.description}</p>
										{isEndingAtPeriodEnd && (
											<div className='mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2'>
												<p className='text-sm font-medium text-foreground'>
													Subscription will not renew
												</p>
												<p className='text-sm text-muted-foreground'>
													Your plan remains active through{' '}
													{formatDate(
														billing.data.billingAccessEndsAt ??
															billing.data.currentPeriodEndsAt,
													)}
													. It will end after that date.
												</p>
											</div>
										)}
									</div>
								) : (
									<p className='text-sm text-muted-foreground'>
										Current plan details are unavailable.
									</p>
								)
							) : (
								<div className='flex flex-col gap-2'>
									<div className='flex flex-wrap items-center gap-2'>
										<p className='font-medium text-foreground'>No active plan</p>
										{isHistoricalSubscription && (
											<Badge variant={statusView.variant}>{statusView.label}</Badge>
										)}
									</div>
									<p className='text-sm text-muted-foreground'>
										{isHistoricalSubscription
											? statusView.description
											: billing.data.trialAvailable
												? 'Your free trial has not started.'
												: 'This organization is not eligible for another free trial.'}
									</p>
								</div>
							))}
					</SettingsCard>

					{billing.data?.trialAvailable && !hasSubscription && plan && (
						<SettingsCard title='Available plan'>
							<div className='flex flex-col gap-5'>
								<div>
									<div className='mb-1 text-sm font-medium text-foreground'>{plan.name}</div>
									<div className='text-2xl font-semibold text-foreground'>
										{formatPrice(plan.amount, plan.currency)}
									</div>
									<div className='text-sm text-muted-foreground'>
										per {formatInterval(plan.interval, plan.intervalCount)}
									</div>
								</div>

								<dl className='grid gap-3 text-sm sm:grid-cols-2'>
									<PlanDetail
										label='Users'
										value={plan.userLimit === null ? 'Unlimited' : String(plan.userLimit)}
									/>
									<PlanDetail
										label='Billing period'
										value={`Every ${formatInterval(plan.interval, plan.intervalCount)}`}
									/>
									<PlanDetail label='Trial' value={`${plan.trialDays} days after starting`} />
									<PlanDetail label='Currency' value={plan.currency.toUpperCase()} />
								</dl>

								<div className='flex flex-col items-start gap-3 border-t border-border pt-5'>
									<p className='text-sm text-muted-foreground'>
										Start your 14-day free trial when you are ready. No payment method is required.
									</p>
									{billing.data.canManageBilling ? (
										isConfirmingTrial ? (
											<div className='flex flex-col items-start gap-2'>
												<p className='text-sm text-muted-foreground'>
													{isCheckoutPolling
														? 'Confirming your trial with Stripe…'
														: 'Stripe confirmation is taking longer than expected.'}
												</p>
												{!isCheckoutPolling && (
													<Button
														variant='secondary'
														size='sm'
														onClick={() => {
															setIsCheckoutPolling(true);
															void billing.refetch();
														}}
													>
														Refresh status
													</Button>
												)}
											</div>
										) : billing.data.trialAvailable ? (
											<Button onClick={() => checkout.mutate()} isLoading={checkout.isPending}>
												Start 14-day free trial
											</Button>
										) : (
											<p className='text-sm text-muted-foreground'>
												This organization is not eligible for another trial.
											</p>
										)
									) : (
										<p className='text-sm text-muted-foreground'>
											Only an organization admin can start the trial.
										</p>
									)}
									{checkout.isError && (
										<p className='text-sm text-destructive'>
											Unable to start the trial. Please try again.
										</p>
									)}
								</div>
							</div>
						</SettingsCard>
					)}

					{billing.data && hasSubscription && (
						<SettingsCard
							title={isHistoricalSubscription ? 'Subscription history' : 'Subscription details'}
						>
							{isHistoricalSubscription && plan && (
								<div className='mb-5 flex flex-col gap-1'>
									<p className='font-medium text-foreground'>{plan.name}</p>
									<p className='text-sm text-muted-foreground'>
										{formatPrice(plan.amount, plan.currency)} per{' '}
										{formatInterval(plan.interval, plan.intervalCount)} · kept for billing history
									</p>
								</div>
							)}
							<dl className='grid gap-3 text-sm sm:grid-cols-2'>
								<PlanDetail label='Status' value={statusView.label} />
								<PlanDetail label='Trial started' value={formatDate(billing.data.trialStartedAt)} />
								<PlanDetail
									label={status === 'trialing' ? 'Trial ends' : 'Trial ended'}
									value={formatDate(billing.data.trialEndsAt)}
								/>
								<PlanDetail
									label='Current period ends'
									value={formatDate(billing.data.currentPeriodEndsAt)}
								/>
								<PlanDetail
									label='Access through'
									value={formatDate(billing.data.billingAccessEndsAt)}
								/>
								<PlanDetail
									label='Renewal'
									value={formatRenewal(status, billing.data.cancelAtPeriodEnd ?? false)}
								/>
							</dl>
						</SettingsCard>
					)}

					{billing.data?.invoiceHistoryAvailable && (
						<SettingsCard title='Invoices'>
							{!billing.data.canManageBilling ? (
								<p className='text-sm text-muted-foreground'>
									Only an organization admin can view invoices.
								</p>
							) : invoices.isLoading ? (
								<p className='text-sm text-muted-foreground'>Loading invoices…</p>
							) : invoices.isError ? (
								<p className='text-sm text-destructive'>Unable to load invoices.</p>
							) : invoices.data?.length ? (
								<div className='flex flex-col divide-y divide-border'>
									{invoices.data.map((invoice) => (
										<div
											key={invoice.id}
											className='flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between'
										>
											<div>
												<p className='font-medium text-foreground'>
													{invoice.number ?? 'Invoice'}
												</p>
												<p className='text-sm text-muted-foreground'>
													{formatDate(invoice.createdAt)} ·{' '}
													{formatPrice(invoice.total, invoice.currency)} ·{' '}
													{formatStatus(invoice.status)}
												</p>
											</div>
											<div className='flex flex-wrap gap-2'>
												{invoice.hostedInvoiceUrl && (
													<Button variant='secondary' size='sm' asChild>
														<a
															href={invoice.hostedInvoiceUrl}
															target='_blank'
															rel='noreferrer'
														>
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
					)}

					{billing.data && hasSubscription && (
						<SettingsCard title='Billing management'>
							{billing.data.canManageBilling ? (
								<div className='flex flex-col items-start gap-3'>
									{billing.data.portalAvailable ||
									billing.data.paymentMethodManagementAvailable ||
									billing.data.resubscribeAvailable ? (
										<>
											<p className='text-sm text-muted-foreground'>
												{getManagementDescription(status)}
											</p>
											<div className='flex flex-wrap gap-2'>
												{billing.data.resubscribeAvailable && (
													<Button
														onClick={() =>
															resubscribe.mutate({ requestId: crypto.randomUUID() })
														}
														isLoading={resubscribe.isPending}
														disabled={isConfirmingSubscription}
													>
														Start new subscription
													</Button>
												)}
												{billing.data.paymentMethodManagementAvailable && (
													<Button
														variant={
															billing.data.resubscribeAvailable ? 'secondary' : 'default'
														}
														onClick={() =>
															paymentMethodPortal.mutate({
																requestId: crypto.randomUUID(),
															})
														}
														isLoading={paymentMethodPortal.isPending}
													>
														Manage payment method
													</Button>
												)}
												{billing.data.portalAvailable && (
													<Button
														variant='secondary'
														onClick={() =>
															portal.mutate({ requestId: crypto.randomUUID() })
														}
														isLoading={portal.isPending}
													>
														{getPortalButtonLabel(status)}
													</Button>
												)}
												{status === 'paused' && (
													<Button
														variant='secondary'
														onClick={() =>
															resumeSubscription.mutate({
																requestId: crypto.randomUUID(),
															})
														}
														isLoading={resumeSubscription.isPending}
													>
														Resume subscription
													</Button>
												)}
											</div>
											{isConfirmingSubscription && (
												<div className='flex flex-col items-start gap-2'>
													<p className='text-sm text-muted-foreground'>
														{isCheckoutPolling
															? 'Confirming your new subscription with Stripe…'
															: 'Stripe confirmation is taking longer than expected.'}
													</p>
													{!isCheckoutPolling && (
														<Button
															variant='secondary'
															size='sm'
															onClick={() => {
																setIsCheckoutPolling(true);
																void billing.refetch();
															}}
														>
															Refresh status
														</Button>
													)}
												</div>
											)}
											{status === 'trialing' && (
												<p className='text-xs text-muted-foreground'>
													Without a payment method, Stripe pauses the subscription when the
													trial ends.
												</p>
											)}
										</>
									) : (
										<p className='text-sm text-muted-foreground'>
											Billing management is not available for this subscription.
										</p>
									)}
									{(portal.isError ||
										paymentMethodPortal.isError ||
										resubscribe.isError ||
										resumeSubscription.isError) && (
										<p className='text-sm text-destructive'>
											{resumeSubscription.error?.message ??
												resubscribe.error?.message ??
												paymentMethodPortal.error?.message ??
												'Unable to open Stripe billing. Please try again.'}
										</p>
									)}
								</div>
							) : (
								<p className='text-sm text-muted-foreground'>
									Only an organization admin can manage billing.
								</p>
							)}
						</SettingsCard>
					)}
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

type StatusView = {
	label: string;
	description: string;
	variant: 'success' | 'secondary' | 'destructive' | 'outline';
};

function getStatusView(status: string | null, cancelAtPeriodEnd: boolean): StatusView {
	switch (status) {
		case 'trialing':
			return {
				label: 'Free trial',
				description: cancelAtPeriodEnd
					? 'Your trial is scheduled to end without renewal.'
					: 'Your free trial is active. Add payment details before it ends to continue.',
				variant: 'secondary',
			};
		case 'active':
			return {
				label: cancelAtPeriodEnd ? 'Active · not renewing' : 'Active',
				description: cancelAtPeriodEnd
					? 'Your plan remains active until the end of the current billing period.'
					: 'Your subscription is active and renews automatically.',
				variant: cancelAtPeriodEnd ? 'secondary' : 'success',
			};
		case 'past_due':
			return {
				label: 'Payment past due',
				description: 'A payment failed. Update your payment details to avoid losing access.',
				variant: 'destructive',
			};
		case 'unpaid':
			return {
				label: 'Unpaid',
				description: 'Payment retries have stopped. Update your billing details in Stripe.',
				variant: 'destructive',
			};
		case 'paused':
			return {
				label: 'Paused',
				description: 'Your trial ended without a payment method. Add one, then resume the subscription.',
				variant: 'secondary',
			};
		case 'incomplete':
			return {
				label: 'Setup incomplete',
				description: 'Subscription setup still needs payment confirmation.',
				variant: 'destructive',
			};
		case 'incomplete_expired':
			return {
				label: 'Setup expired',
				description: 'The unfinished subscription expired and is kept as billing history.',
				variant: 'outline',
			};
		case 'canceled':
			return {
				label: 'Canceled',
				description:
					'Your previous subscription is canceled and kept as billing history. It cannot be resumed.',
				variant: 'outline',
			};
		default:
			return {
				label: 'Not started',
				description: 'No subscription has been started.',
				variant: 'outline',
			};
	}
}

function getManagementDescription(status: string | null): string {
	switch (status) {
		case 'paused':
			return 'Add a payment method in Stripe, then return here to resume your subscription.';
		case 'past_due':
		case 'unpaid':
		case 'incomplete':
			return 'Update your payment details and resolve the outstanding payment in Stripe.';
		case 'canceled':
		case 'incomplete_expired':
			return 'This subscription is historical and cannot be resumed. Start a new subscription or review its billing records.';
		default:
			return 'Add payment details, view invoices, or manage your subscription with Stripe.';
	}
}

function getPortalButtonLabel(status: string | null): string {
	return status === 'canceled' || status === 'incomplete_expired' ? 'Open billing history' : 'Manage subscription';
}

function isTerminalStatus(status: string | null | undefined): boolean {
	return status === 'canceled' || status === 'incomplete_expired';
}

function formatRenewal(status: string | null, cancelAtPeriodEnd: boolean): string {
	if (cancelAtPeriodEnd && status !== 'canceled') {
		return 'Will not renew';
	}
	switch (status) {
		case 'trialing':
			return 'Starts after trial';
		case 'active':
		case 'past_due':
			return 'Renews automatically';
		case 'paused':
			return 'Paused';
		case 'canceled':
			return 'Ended';
		case 'unpaid':
			return 'Payment stopped';
		case 'incomplete':
			return 'Pending setup';
		case 'incomplete_expired':
			return 'Expired';
		default:
			return '—';
	}
}

function formatPrice(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency.toUpperCase(),
		maximumFractionDigits: 0,
	}).format(amount / 100);
}

function formatInterval(interval: string, intervalCount: number): string {
	return intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
}

function formatStatus(status: string | null): string {
	return status
		? status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
		: 'Not configured';
}

function formatDate(date: Date | null): string {
	return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '—';
}

function PlanDetail({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className='text-xs text-muted-foreground'>{label}</dt>
			<dd className='font-medium text-foreground'>{value}</dd>
		</div>
	);
}
