import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { trpc } from '@/main';

const CONFIRMATION_TIMEOUT_MS = 15_000;

export function useCreditTopUp(creditCheckout: string | undefined) {
	const queryClient = useQueryClient();
	const checkoutSessionId = creditCheckout && creditCheckout !== 'canceled' ? creditCheckout : '';
	const [isPolling, setIsPolling] = useState(Boolean(checkoutSessionId));
	const {
		data: confirmationData,
		mutateAsync: confirmTopUp,
		reset: resetConfirmation,
	} = useMutation(trpc.billing.confirmCreditTopUp.mutationOptions());
	const checkout = useMutation(
		trpc.billing.createCreditTopUpCheckoutSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);

	useEffect(() => {
		resetConfirmation();
		setIsPolling(Boolean(checkoutSessionId));
	}, [checkoutSessionId, resetConfirmation]);

	useEffect(() => {
		if (!checkoutSessionId || !isPolling) {
			return;
		}
		let timeout: number | undefined;
		let cancelled = false;
		const confirm = async () => {
			const confirmed = await confirmTopUp({ checkoutSessionId })
				.then(({ credited }) => credited)
				.catch(() => false);
			if (!cancelled && !confirmed) {
				timeout = window.setTimeout(() => void confirm(), 2_000);
			}
		};
		void confirm();
		return () => {
			cancelled = true;
			if (timeout !== undefined) {
				window.clearTimeout(timeout);
			}
		};
	}, [checkoutSessionId, confirmTopUp, isPolling]);

	useEffect(() => {
		if (!confirmationData?.credited) {
			return;
		}
		setIsPolling(false);
		void Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.account.getManagedCreditStatus.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.account.getCreditSummary.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.account.listCreditLedger.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.account.listManagedAiUsage.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.listAvailableTranscribeModels.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getDefaultChatModel.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.billing.getInvoices.queryKey() }),
		]);
	}, [confirmationData?.credited, queryClient]);

	useEffect(() => {
		if (!isPolling) {
			return;
		}
		const timeout = window.setTimeout(() => setIsPolling(false), CONFIRMATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [checkoutSessionId, isPolling]);

	const feedback =
		creditCheckout === 'canceled'
			? 'Credit Checkout was canceled. No credits were added.'
			: confirmationData?.credited
				? 'Credits were added to the organization wallet.'
				: checkoutSessionId
					? isPolling
						? 'Confirming your credit purchase with Stripe…'
						: 'Stripe confirmation is taking longer than expected.'
					: null;

	return {
		feedback,
		isPending: checkout.isPending,
		error: checkout.error?.message ?? null,
		startCheckout: (creditAmountCents: number) =>
			checkout.mutate({ creditAmountCents, requestId: crypto.randomUUID() }),
		retryConfirmation: () => {
			setIsPolling(true);
		},
		showRetry: Boolean(checkoutSessionId && !confirmationData?.credited && !isPolling),
	};
}
