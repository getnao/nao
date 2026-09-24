import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getBillingStatusView, isHistoricalBillingStatus } from '@/lib/billing-display';
import { trpc } from '@/main';

const STATUS_CONFIRMATION_TIMEOUT_MS = 15_000;

export type OrganizationBillingSearch = {
	checkout?: 'success' | 'subscribed' | 'canceled';
	portal?: 'returned';
};

export function useOrganizationBilling(search: OrganizationBillingSearch) {
	const queryClient = useQueryClient();
	const initialStatusSyncRequested = useRef(false);
	const [isResumeConfirming, setIsResumeConfirming] = useState(false);
	const [isCheckoutPolling, setIsCheckoutPolling] = useState(
		search.checkout === 'success' || search.checkout === 'subscribed',
	);
	const [isPortalPolling, setIsPortalPolling] = useState(search.portal === 'returned');
	const billing = useQuery({
		...trpc.billing.getStatus.queryOptions(),
		refetchOnWindowFocus: 'always',
		refetchInterval: (query) =>
			(isCheckoutPolling &&
				(search.checkout === 'subscribed'
					? isHistoricalBillingStatus(query.state.data?.status)
					: !query.state.data?.hasStripeSubscription)) ||
			(query.state.data?.status === 'paused' && isResumeConfirming) ||
			isPortalPolling
				? 2_000
				: false,
	});
	const invoices = useQuery({
		...trpc.billing.getInvoices.queryOptions(),
		enabled: billing.data?.canManageBilling === true && billing.data.invoiceHistoryAvailable,
		refetchOnWindowFocus: 'always',
	});
	const startTrial = useMutation(
		trpc.billing.startTrial.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					billing.refetch(),
					queryClient.invalidateQueries({ queryKey: trpc.billing.getAccess.queryKey() }),
				]);
			},
		}),
	);
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
	const syncStripeBilling = useMutation(
		trpc.billing.syncStripeBilling.mutationOptions({
			onSuccess: async () => {
				await Promise.all([billing.refetch(), invoices.refetch()]);
				setIsPortalPolling(false);
			},
		}),
	);

	const plan = billing.data?.plan ?? billing.data?.availablePlan;
	const hasStripeSubscription = billing.data?.hasStripeSubscription === true;
	const status = billing.data?.status ?? null;
	const isHistoricalSubscription = isHistoricalBillingStatus(status);
	const isLocalTrialExpired =
		status === 'trialing' && !hasStripeSubscription && billing.data?.localTrialActive === false;
	const isCheckoutConfirmed =
		search.checkout === 'subscribed'
			? hasStripeSubscription && !isHistoricalSubscription
			: search.checkout === 'success'
				? hasStripeSubscription
				: false;
	const statusView = getBillingStatusView(
		status,
		billing.data?.cancelAtPeriodEnd ?? false,
		billing.data?.hasDefaultPaymentMethod === true,
		isLocalTrialExpired,
	);
	const isEndingAtPeriodEnd =
		billing.data?.cancelAtPeriodEnd === true && (status === 'active' || status === 'trialing');
	const canSyncStripeBilling =
		billing.data?.canManageBilling === true && billing.data.paymentMethodManagementAvailable;
	const shouldAutoSyncStripeBilling =
		canSyncStripeBilling &&
		(search.portal === 'returned' || search.checkout === 'success' || search.checkout === 'subscribed');
	const syncBillingWithStripe = syncStripeBilling.mutate;
	const isSyncingBillingWithStripe = syncStripeBilling.isPending;

	useEffect(() => {
		if (!isCheckoutPolling || isCheckoutConfirmed) {
			return;
		}
		const timeout = window.setTimeout(() => setIsCheckoutPolling(false), STATUS_CONFIRMATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [isCheckoutConfirmed, isCheckoutPolling]);

	useEffect(() => {
		if (!isResumeConfirming) {
			return;
		}
		const timeout = window.setTimeout(() => setIsResumeConfirming(false), STATUS_CONFIRMATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [isResumeConfirming]);

	useEffect(() => {
		if (!shouldAutoSyncStripeBilling || initialStatusSyncRequested.current) {
			return;
		}
		initialStatusSyncRequested.current = true;
		syncBillingWithStripe();
	}, [shouldAutoSyncStripeBilling, syncBillingWithStripe]);

	useEffect(() => {
		if (!canSyncStripeBilling) {
			return;
		}
		const refreshOnFocus = () => {
			if (!isSyncingBillingWithStripe) {
				syncBillingWithStripe();
			}
		};
		window.addEventListener('focus', refreshOnFocus);
		return () => window.removeEventListener('focus', refreshOnFocus);
	}, [canSyncStripeBilling, isSyncingBillingWithStripe, syncBillingWithStripe]);

	useEffect(() => {
		if (!isPortalPolling) {
			return;
		}
		const timeout = window.setTimeout(() => setIsPortalPolling(false), 60_000);
		return () => window.clearTimeout(timeout);
	}, [isPortalPolling]);

	const checkoutFeedback = getCheckoutFeedback(search.checkout, isCheckoutConfirmed, isCheckoutPolling);
	const portalFeedback =
		search.portal === 'returned'
			? syncStripeBilling.isPending || isPortalPolling
				? 'Refreshing billing changes from Stripe…'
				: 'Billing details refreshed from Stripe.'
			: null;

	return {
		billing,
		invoices,
		plan,
		status,
		statusView,
		hasStripeSubscription,
		isHistoricalSubscription,
		isLocalTrialExpired,
		isEndingAtPeriodEnd,
		isCheckoutPolling,
		isCheckoutConfirmationDelayed:
			(search.checkout === 'success' || search.checkout === 'subscribed') &&
			!isCheckoutConfirmed &&
			!isCheckoutPolling,
		checkoutFeedback,
		portalFeedback,
		checkoutError: checkout.isError ? checkout.error.message : null,
		trialError: startTrial.isError ? startTrial.error.message : null,
		managementError:
			resumeSubscription.error?.message ??
			resubscribe.error?.message ??
			paymentMethodPortal.error?.message ??
			portal.error?.message ??
			syncStripeBilling.error?.message ??
			null,
		isCheckoutPending: checkout.isPending,
		isTrialPending: startTrial.isPending,
		isPortalPending: portal.isPending,
		isPaymentMethodPortalPending: paymentMethodPortal.isPending,
		isResubscribePending: resubscribe.isPending,
		isResumePending: resumeSubscription.isPending,
		isBillingSyncPending: syncStripeBilling.isPending,
		subscribe: () => checkout.mutate(),
		startTrial: () => startTrial.mutate(),
		openPortal: () => portal.mutate({ requestId: crypto.randomUUID() }),
		openPaymentMethodPortal: () => paymentMethodPortal.mutate({ requestId: crypto.randomUUID() }),
		resubscribe: () => resubscribe.mutate(),
		resume: () => resumeSubscription.mutate({ requestId: crypto.randomUUID() }),
		syncBilling: () => {
			setIsPortalPolling(true);
			syncStripeBilling.mutate();
		},
		retryCheckoutConfirmation: () => {
			setIsCheckoutPolling(true);
			void billing.refetch();
		},
	};
}

function getCheckoutFeedback(
	checkout: OrganizationBillingSearch['checkout'],
	isConfirmed: boolean,
	isPolling: boolean,
): string | null {
	if (checkout === 'canceled') {
		return 'Checkout was canceled. Your billing status was not changed.';
	}
	if (checkout !== 'success' && checkout !== 'subscribed') {
		return null;
	}
	if (isConfirmed) {
		return 'Subscription confirmed.';
	}
	return isPolling
		? 'Confirming your subscription with Stripe…'
		: 'Stripe confirmation is taking longer than expected.';
}
