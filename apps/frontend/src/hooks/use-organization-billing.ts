import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { CloudBillingCurrency, CloudBillingInterval, CloudBillingPlanKey } from '@nao/shared/billing';

import type { OrganizationBillingSearch } from '@/hooks/use-organization-billing-sync';
import { useOrganizationBillingSync } from '@/hooks/use-organization-billing-sync';
import { trpc } from '@/main';

export type { OrganizationBillingSearch, OrganizationBillingTab } from '@/hooks/use-organization-billing-sync';
export type OrganizationBillingState = ReturnType<typeof useOrganizationBilling>;
export type CloudBillingStatus = inferRouterOutputs<TrpcRouter>['billing']['getStatus'];
export type CloudBillingChangePreview = inferRouterOutputs<TrpcRouter>['billing']['previewChange'];

export function useOrganizationBilling(search: OrganizationBillingSearch) {
	const [selectedBillingInterval, setSelectedBillingInterval] = useState<CloudBillingInterval>('monthly');
	const [selectedBillingCurrency, setSelectedBillingCurrency] = useState<CloudBillingCurrency>('usd');
	const billingSync = useOrganizationBillingSync(search);
	const { billing, invoices } = billingSync;
	const lockedBillingCurrency = billing.data?.currency ?? null;
	const billingCurrency = lockedBillingCurrency ?? selectedBillingCurrency;
	const paidPlanSelected = billing.data?.paidPlanSelected === true;
	const canLoadUpcomingInvoice =
		paidPlanSelected &&
		!billing.data?.cancellationScheduled &&
		(billing.data?.status === 'trialing' ||
			billing.data?.status === 'active' ||
			billing.data?.status === 'past_due');
	const upcomingInvoice = useQuery({
		...trpc.billing.getUpcomingInvoice.queryOptions(),
		enabled: canLoadUpcomingInvoice,
		refetchOnWindowFocus: false,
	});
	const redirectOptions = {
		onSuccess: ({ url }: { url: string }) => {
			window.location.href = url;
		},
	};
	const trialCheckout = useMutation(trpc.billing.createTrialCheckoutSession.mutationOptions(redirectOptions));
	const resubscribe = useMutation(trpc.billing.createResubscribeSession.mutationOptions(redirectOptions));
	const portal = useMutation(trpc.billing.createPortalSession.mutationOptions(redirectOptions));
	const paymentMethodPortal = useMutation(trpc.billing.createPaymentMethodSession.mutationOptions(redirectOptions));
	const resumeSubscription = useMutation(
		trpc.billing.resumeSubscription.mutationOptions({
			onSuccess: () => {
				billingSync.setIsResumeConfirming(true);
				void billing.refetch();
			},
		}),
	);
	const commandOptions = { onSuccess: billingSync.invalidateBillingAndMembers };
	const previewChange = useMutation(trpc.billing.previewChange.mutationOptions());
	const confirmChange = useConfirmCloudBillingChange(billingSync.invalidateBillingAndMembers);
	const selectSeats = useMutation(trpc.billing.selectSeats.mutationOptions(commandOptions));
	const switchToFree = useMutation(trpc.billing.switchToFree.mutationOptions(commandOptions));
	const keepPlan = useMutation(trpc.billing.keepPlan.mutationOptions(commandOptions));
	const cancelPendingChange = useMutation(trpc.billing.cancelPendingChange.mutationOptions(commandOptions));
	const startsWithTrialCheckout =
		billing.data?.needsPaidPlanSelection === true || billing.data?.trialAvailable === true;

	return {
		billing,
		invoices,
		upcomingInvoice,
		canLoadUpcomingInvoice,
		status: billingSync.status,
		paidPlanSelected,
		isHistoricalSubscription: billingSync.isHistoricalSubscription,
		selectedBillingInterval,
		setSelectedBillingInterval,
		billingCurrency,
		isBillingCurrencyLocked: lockedBillingCurrency !== null,
		setSelectedBillingCurrency,
		isCheckoutPolling: billingSync.isCheckoutPolling,
		isCheckoutConfirmationDelayed: billingSync.isCheckoutConfirmationDelayed,
		checkoutFeedback: billingSync.checkoutFeedback,
		portalFeedback: billingSync.portalFeedback,
		syncError: billingSync.syncError,
		checkoutError: (startsWithTrialCheckout ? trialCheckout.error : resubscribe.error)?.message ?? null,
		managementError:
			resumeSubscription.error?.message ??
			paymentMethodPortal.error?.message ??
			portal.error?.message ??
			keepPlan.error?.message ??
			cancelPendingChange.error?.message ??
			null,
		isCheckoutPending: trialCheckout.isPending || resubscribe.isPending,
		isPortalPending: portal.isPending,
		isPaymentMethodPortalPending: paymentMethodPortal.isPending,
		isResumePending: resumeSubscription.isPending,
		isBillingSyncPending: billingSync.isBillingSyncPending,
		isCommandPending:
			confirmChange.isPending ||
			selectSeats.isPending ||
			switchToFree.isPending ||
			keepPlan.isPending ||
			cancelPendingChange.isPending,
		startCheckout: (planKey: CloudBillingPlanKey, seats?: number) => {
			const input = { planKey, seats, currency: billingCurrency };
			return startsWithTrialCheckout ? trialCheckout.mutateAsync(input) : resubscribe.mutateAsync(input);
		},
		previewChange: (targetPlanKey: CloudBillingPlanKey, seats?: number, promotionCode?: string) =>
			previewChange.mutateAsync({ targetPlanKey, seats, promotionCode }),
		confirmChange: (previewToken: string) =>
			confirmChange.mutateAsync({ previewToken, requestId: crypto.randomUUID() }),
		selectSeats: (selectedUserIds: string[]) => selectSeats.mutateAsync({ selectedUserIds }),
		switchToFree: (selectedUserIds?: string[]) =>
			switchToFree.mutateAsync({ selectedUserIds, requestId: crypto.randomUUID() }),
		keepPlan: () => keepPlan.mutate({ requestId: crypto.randomUUID() }),
		cancelPendingChange: () => cancelPendingChange.mutate(),
		openPortal: () => portal.mutate({ requestId: crypto.randomUUID() }),
		openPaymentMethodPortal: () => paymentMethodPortal.mutate({ requestId: crypto.randomUUID() }),
		resume: () => resumeSubscription.mutate({ requestId: crypto.randomUUID() }),
		syncBilling: billingSync.syncBilling,
		retryCheckoutConfirmation: billingSync.retryCheckoutConfirmation,
	};
}

/** Paid upgrades wait for their invoice, so the admin is sent to Stripe to pay it before the change applies. */
export function useConfirmCloudBillingChange(onCompleted: () => Promise<unknown>) {
	return useMutation(
		trpc.billing.confirmChange.mutationOptions({
			onSuccess: async (result) => {
				if (result.status === 'payment_pending') {
					window.location.href = result.hostedInvoiceUrl;
					return;
				}
				await onCompleted();
			},
		}),
	);
}
