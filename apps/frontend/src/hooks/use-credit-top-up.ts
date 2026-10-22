import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { trpc } from '@/main';

const CONFIRMATION_TIMEOUT_MS = 15_000;

export function useCreditTopUp(creditCheckout: string | undefined) {
	const queryClient = useQueryClient();
	const checkoutSessionId = creditCheckout && creditCheckout !== 'canceled' ? creditCheckout : '';
	const [isPolling, setIsPolling] = useState(Boolean(checkoutSessionId));
	const status = useQuery({
		...trpc.billing.getCreditTopUpStatus.queryOptions({ checkoutSessionId }),
		enabled: Boolean(checkoutSessionId),
		refetchInterval: (query) => (isPolling && query.state.data?.credited !== true ? 2_000 : false),
		refetchOnWindowFocus: false,
	});
	const checkout = useMutation(
		trpc.billing.createCreditTopUpCheckoutSession.mutationOptions({
			onSuccess: ({ url }) => {
				window.location.href = url;
			},
		}),
	);

	useEffect(() => {
		setIsPolling(Boolean(checkoutSessionId));
	}, [checkoutSessionId]);

	useEffect(() => {
		if (!status.data?.credited) {
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
	}, [queryClient, status.data?.credited]);

	useEffect(() => {
		if (!isPolling || status.data?.credited) {
			return;
		}
		const timeout = window.setTimeout(() => setIsPolling(false), CONFIRMATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [checkoutSessionId, isPolling, status.data?.credited]);

	const feedback =
		creditCheckout === 'canceled'
			? 'Credit Checkout was canceled. No credits were added.'
			: status.data?.credited
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
			void status.refetch();
		},
		showRetry: Boolean(checkoutSessionId && !status.data?.credited && !isPolling),
	};
}
