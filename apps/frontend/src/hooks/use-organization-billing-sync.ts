import { isTerminalBillingStatus } from '@nao/shared/billing';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { CloudBillingCurrency } from '@nao/shared/billing';

import { trpc } from '@/main';

const STATUS_CONFIRMATION_TIMEOUT_MS = 15_000;

export type OrganizationBillingSearch = {
	checkout?: 'success' | 'subscribed' | 'canceled';
	portal?: 'returned';
};

export function useOrganizationBillingSync(
	search: OrganizationBillingSearch,
	selectedBillingCurrency: CloudBillingCurrency,
) {
	const queryClient = useQueryClient();
	const initialStatusSyncRequested = useRef(false);
	const [isResumeConfirming, setIsResumeConfirming] = useState(false);
	const [isCheckoutPolling, setIsCheckoutPolling] = useState(
		search.checkout === 'success' || search.checkout === 'subscribed',
	);
	const [isBillingRefreshPolling, setIsBillingRefreshPolling] = useState(search.portal === 'returned');
	const billing = useQuery({
		...trpc.billing.getStatus.queryOptions({ currency: selectedBillingCurrency }),
		refetchOnWindowFocus: false,
		refetchInterval: (query) =>
			(isCheckoutPolling &&
				(!query.state.data?.hasStripeSubscription ||
					(search.checkout === 'subscribed' && isTerminalBillingStatus(query.state.data?.status)))) ||
			(query.state.data?.status === 'paused' && isResumeConfirming) ||
			isBillingRefreshPolling
				? 2_000
				: false,
	});
	const invoices = useQuery({
		...trpc.billing.getInvoices.queryOptions(),
		enabled: billing.data?.canManageBilling === true && billing.data.invoiceHistoryAvailable,
		refetchOnWindowFocus: false,
	});
	const syncStripeBilling = useMutation(
		trpc.billing.syncStripeBilling.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					billing.refetch(),
					invoices.refetch(),
					queryClient.invalidateQueries({ queryKey: trpc.billing.getUpcomingInvoice.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.billing.getAccess.queryKey() }),
				]);
				setIsBillingRefreshPolling(false);
			},
		}),
	);
	const hasStripeSubscription = billing.data?.hasStripeSubscription === true;
	const status = billing.data?.status ?? null;
	const isHistoricalSubscription = isTerminalBillingStatus(status);
	const isCheckoutConfirmed =
		search.checkout === 'subscribed'
			? hasStripeSubscription && !isHistoricalSubscription
			: search.checkout === 'success'
				? hasStripeSubscription
				: false;
	const canSyncStripeBilling =
		billing.data?.canManageBilling === true && billing.data.paymentMethodManagementAvailable;
	const shouldAutoSyncStripeBilling =
		canSyncStripeBilling &&
		(search.portal === 'returned' || search.checkout === 'success' || search.checkout === 'subscribed');
	const syncBillingWithStripe = syncStripeBilling.mutate;

	useEffect(() => {
		if (!isCheckoutPolling) {
			return;
		}
		if (isCheckoutConfirmed) {
			setIsCheckoutPolling(false);
			return;
		}
		const timeout = window.setTimeout(() => setIsCheckoutPolling(false), STATUS_CONFIRMATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [isCheckoutConfirmed, isCheckoutPolling]);

	useEffect(() => {
		if (status) {
			void queryClient.invalidateQueries({ queryKey: trpc.billing.getAccess.queryKey() });
		}
	}, [queryClient, status]);

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
		if (!isBillingRefreshPolling) {
			return;
		}
		const timeout = window.setTimeout(() => setIsBillingRefreshPolling(false), 60_000);
		return () => window.clearTimeout(timeout);
	}, [isBillingRefreshPolling]);

	const checkoutFeedback = getCheckoutFeedback(search.checkout, isCheckoutConfirmed, isCheckoutPolling);
	const portalFeedback =
		search.portal === 'returned'
			? syncStripeBilling.isError
				? 'Unable to refresh billing details from Stripe.'
				: syncStripeBilling.isPending || isBillingRefreshPolling
					? 'Refreshing billing changes from Stripe…'
					: 'Billing details refreshed from Stripe.'
			: null;

	return {
		billing,
		invoices,
		status,
		hasStripeSubscription,
		isHistoricalSubscription,
		isCheckoutPolling,
		isCheckoutConfirmationDelayed:
			(search.checkout === 'success' || search.checkout === 'subscribed') &&
			!isCheckoutConfirmed &&
			!isCheckoutPolling,
		checkoutFeedback,
		portalFeedback,
		syncError: syncStripeBilling.error?.message ?? null,
		isBillingSyncPending: syncStripeBilling.isPending,
		setIsResumeConfirming,
		syncBilling: () => {
			setIsBillingRefreshPolling(true);
			syncStripeBilling.mutate();
		},
		retryCheckoutConfirmation: () => {
			setIsCheckoutPolling(true);
			syncStripeBilling.mutate();
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
		return null;
	}
	return isPolling
		? 'Confirming your subscription with Stripe…'
		: 'Stripe confirmation is taking longer than expected.';
}
