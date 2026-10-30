import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getCloudBillingPlanDefinition } from '@nao/shared/billing';
import type { CloudBillingInterval, CloudBillingPlanKey, PaidCloudBillingTier } from '@nao/shared/billing';

import type { OrganizationBillingSearch } from '@/hooks/use-organization-billing-sync';
import { useOrganizationBillingSync } from '@/hooks/use-organization-billing-sync';
import { getBrowserBillingCurrency } from '@/lib/billing-currency';
import { getBillingStatusView } from '@/lib/billing-display';
import { trpc } from '@/main';

export type { OrganizationBillingSearch, OrganizationBillingTab } from '@/hooks/use-organization-billing-sync';
export type BillingInterval = CloudBillingInterval;

export function useOrganizationBilling(search: OrganizationBillingSearch) {
	const [selectedBillingInterval, setSelectedBillingInterval] = useState<BillingInterval>('monthly');
	const [selectedBillingTier, setSelectedBillingTier] = useState<PaidCloudBillingTier>('unlimited');
	const selectedBillingCurrency = getBrowserBillingCurrency();
	const billingSync = useOrganizationBillingSync(search, selectedBillingCurrency);
	const { billing, invoices } = billingSync;
	const paidPlanSelected = billing.data?.paidPlanSelected === true;
	const needsPaidPlanSelection = billing.data?.needsPaidPlanSelection === true;
	const canLoadUpcomingInvoice =
		billing.data?.canManageBilling === true &&
		paidPlanSelected &&
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
	const billingMutationOptions = {
		onSuccess: async () => {
			billingSync.beginBillingChangePolling();
			await billingSync.invalidateBillingAndMembers();
		},
	};
	const previewSeatChange = useMutation(trpc.billing.previewSeatChange.mutationOptions());
	const changeSeatQuantity = useMutation(trpc.billing.changeSeatQuantity.mutationOptions(billingMutationOptions));
	const previewPlanChange = useMutation(trpc.billing.previewPlanChange.mutationOptions());
	const changePlan = useMutation(trpc.billing.changePlan.mutationOptions(billingMutationOptions));
	const selectSeats = useMutation(trpc.billing.selectSeats.mutationOptions(billingMutationOptions));
	const switchToFree = useMutation(trpc.billing.switchToFree.mutationOptions(billingMutationOptions));
	const keepPlan = useMutation(trpc.billing.keepPlan.mutationOptions(billingMutationOptions));
	const cancelPendingPlanChange = useMutation(
		trpc.billing.cancelPendingPlanChange.mutationOptions(billingMutationOptions),
	);

	const availablePlans = billing.data?.availablePlans;
	const selectedPlan =
		availablePlans && !Array.isArray(availablePlans) ? availablePlans[selectedBillingInterval] : undefined;
	const plan = paidPlanSelected ? (billing.data?.plan ?? selectedPlan) : (selectedPlan ?? billing.data?.plan);
	const { hasStripeSubscription, isHistoricalSubscription, status } = billingSync;
	const freeTierEnabled =
		billing.data !== undefined && 'access' in billing.data && billing.data.access.freeTierEnabled === true;
	const statusView = getBillingStatusView(
		status,
		billing.data?.cancellationScheduled ?? false,
		billing.data?.hasDefaultPaymentMethod === true,
		paidPlanSelected,
		freeTierEnabled,
	);
	const isEndingAtPeriodEnd =
		billing.data?.cancellationScheduled === true && (status === 'active' || status === 'trialing');
	const selectedPlanKey = getCloudBillingPlanDefinition(selectedBillingTier, selectedBillingInterval).key;
	const commandError =
		changeSeatQuantity.error ??
		changePlan.error ??
		selectSeats.error ??
		switchToFree.error ??
		keepPlan.error ??
		cancelPendingPlanChange.error;
	return {
		billing,
		invoices,
		upcomingInvoice,
		canLoadUpcomingInvoice,
		plan,
		status,
		statusView,
		hasStripeSubscription,
		paidPlanSelected,
		needsPaidPlanSelection,
		isHistoricalSubscription,
		isEndingAtPeriodEnd,
		selectedBillingInterval,
		setSelectedBillingInterval,
		selectedBillingTier,
		setSelectedBillingTier,
		selectedPlanKey,
		freeTierEnabled,
		isCheckoutPolling: billingSync.isCheckoutPolling,
		isCheckoutConfirmationDelayed: billingSync.isCheckoutConfirmationDelayed,
		checkoutFeedback: billingSync.checkoutFeedback,
		portalFeedback: billingSync.portalFeedback,
		trialCheckoutError: trialCheckout.isError ? trialCheckout.error.message : null,
		managementError:
			commandError?.message ??
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
				...(freeTierEnabled ? { planKey: selectedPlanKey } : { billingInterval: selectedBillingInterval }),
				currency: selectedBillingCurrency,
			}),
		openTrialCheckoutForPlan: (planKey: CloudBillingPlanKey) =>
			trialCheckout.mutate({ planKey, currency: selectedBillingCurrency }),
		openPortal: () => portal.mutate({ requestId: crypto.randomUUID() }),
		openPaymentMethodPortal: () => paymentMethodPortal.mutate({ requestId: crypto.randomUUID() }),
		resubscribe: () =>
			resubscribe.mutate({
				...(freeTierEnabled ? { planKey: selectedPlanKey } : { billingInterval: selectedBillingInterval }),
				currency: selectedBillingCurrency,
			}),
		resubscribeForPlan: (planKey: CloudBillingPlanKey) =>
			resubscribe.mutate({ planKey, currency: selectedBillingCurrency }),
		previewSeatChange: (targetQuantity: number) => previewSeatChange.mutateAsync({ targetQuantity }),
		confirmSeatChange: (previewToken: string) =>
			changeSeatQuantity.mutateAsync({ previewToken, requestId: crypto.randomUUID() }),
		previewPlanChange: (targetPlanKey: CloudBillingPlanKey, targetSeatQuantity?: number) =>
			previewPlanChange.mutateAsync({ targetPlanKey, targetSeatQuantity }),
		confirmPlanChange: (previewToken: string) =>
			changePlan.mutateAsync({ previewToken, requestId: crypto.randomUUID() }),
		saveSeatSelection: (selectedUserIds: string[]) => selectSeats.mutateAsync({ selectedUserIds }),
		switchToFree: (selectedUserIds?: string[]) => switchToFree.mutateAsync({ selectedUserIds }),
		keepPlan: () => keepPlan.mutateAsync(),
		cancelPendingPlanChange: () => cancelPendingPlanChange.mutateAsync(),
		isBillingCommandPending:
			changeSeatQuantity.isPending ||
			changePlan.isPending ||
			selectSeats.isPending ||
			switchToFree.isPending ||
			keepPlan.isPending ||
			cancelPendingPlanChange.isPending,
		resume: () => resumeSubscription.mutate({ requestId: crypto.randomUUID() }),
		syncBilling: billingSync.syncBilling,
		retryCheckoutConfirmation: billingSync.retryCheckoutConfirmation,
	};
}
