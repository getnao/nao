import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CloudBillingCurrency, CloudBillingInterval } from '@nao/shared/billing';

import type { OrganizationBillingSearch } from '@/hooks/use-organization-billing-sync';
import { useOrganizationBillingSync } from '@/hooks/use-organization-billing-sync';
import { getBillingStatusView } from '@/lib/billing-display';
import { trpc } from '@/main';

export type { OrganizationBillingSearch } from '@/hooks/use-organization-billing-sync';
export type BillingInterval = CloudBillingInterval;
export type BillingCurrency = CloudBillingCurrency;

export function useOrganizationBilling(search: OrganizationBillingSearch) {
	const [selectedBillingInterval, setSelectedBillingInterval] = useState<BillingInterval>('monthly');
	const [selectedBillingCurrency, setSelectedBillingCurrency] = useState<BillingCurrency>('usd');
	const billingSync = useOrganizationBillingSync(search, selectedBillingCurrency);
	const { billing, invoices } = billingSync;
	const canLoadUpcomingInvoice =
		billing.data?.canManageBilling === true &&
		billing.data.hasStripeSubscription &&
		!billing.data.cancellationScheduled &&
		(billing.data.status === 'trialing' || billing.data.status === 'active' || billing.data.status === 'past_due');
	const upcomingInvoice = useQuery({
		...trpc.billing.getUpcomingInvoice.queryOptions(),
		enabled: canLoadUpcomingInvoice,
		refetchOnWindowFocus: false,
	});
	const trialCheckout = useMutation(
		trpc.billing.createTrialCheckoutSession.mutationOptions({
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
				billingSync.setIsResumeConfirming(true);
				void billing.refetch();
			},
		}),
	);

	const selectedPlan = billing.data?.availablePlans?.[selectedBillingInterval];
	const plan = billing.data?.hasStripeSubscription
		? (billing.data.plan ?? selectedPlan)
		: (selectedPlan ?? billing.data?.plan);
	const { hasStripeSubscription, isHistoricalSubscription, status } = billingSync;
	const statusView = getBillingStatusView(
		status,
		billing.data?.cancellationScheduled ?? false,
		billing.data?.hasDefaultPaymentMethod === true,
	);
	const isEndingAtPeriodEnd =
		billing.data?.cancellationScheduled === true && (status === 'active' || status === 'trialing');
	return {
		billing,
		invoices,
		upcomingInvoice,
		canLoadUpcomingInvoice,
		plan,
		status,
		statusView,
		hasStripeSubscription,
		isHistoricalSubscription,
		isEndingAtPeriodEnd,
		selectedBillingInterval,
		setSelectedBillingInterval,
		selectedBillingCurrency,
		setSelectedBillingCurrency,
		isCheckoutPolling: billingSync.isCheckoutPolling,
		isCheckoutConfirmationDelayed: billingSync.isCheckoutConfirmationDelayed,
		checkoutFeedback: billingSync.checkoutFeedback,
		portalFeedback: billingSync.portalFeedback,
		trialCheckoutError: trialCheckout.isError ? trialCheckout.error.message : null,
		managementError:
			resumeSubscription.error?.message ??
			resubscribe.error?.message ??
			paymentMethodPortal.error?.message ??
			portal.error?.message ??
			billingSync.syncError ??
			null,
		isTrialCheckoutPending: trialCheckout.isPending,
		isPortalPending: portal.isPending,
		isPaymentMethodPortalPending: paymentMethodPortal.isPending,
		isResubscribePending: resubscribe.isPending,
		isResumePending: resumeSubscription.isPending,
		isBillingSyncPending: billingSync.isBillingSyncPending,
		openTrialCheckout: () =>
			trialCheckout.mutate({
				billingInterval: selectedBillingInterval,
				currency: selectedBillingCurrency,
			}),
		openPortal: () => portal.mutate({ requestId: crypto.randomUUID() }),
		openPaymentMethodPortal: () => paymentMethodPortal.mutate({ requestId: crypto.randomUUID() }),
		resubscribe: () =>
			resubscribe.mutate({
				billingInterval: selectedBillingInterval,
				currency: selectedBillingCurrency,
			}),
		resume: () => resumeSubscription.mutate({ requestId: crypto.randomUUID() }),
		syncBilling: billingSync.syncBilling,
		retryCheckoutConfirmation: billingSync.retryCheckoutConfirmation,
	};
}
