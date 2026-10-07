// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationBilling } from './use-organization-billing';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
}));

vi.mock('@/main', () => {
	const query = (name: string, queryFn: () => Promise<unknown>) => ({
		queryKey: () => [['billing', name]],
		queryOptions: () => ({ queryKey: [['billing', name]], queryFn }),
	});
	const mutation = () => ({ mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) });
	return {
		trpc: {
			billing: {
				getStatus: query('getStatus', mocks.getStatus),
				getInvoices: query('getInvoices', async () => []),
				getUpcomingInvoice: query('getUpcomingInvoice', async () => null),
				getAccess: query('getAccess', async () => null),
				createTrialCheckoutSession: mutation(),
				createPortalSession: mutation(),
				createPaymentMethodSession: mutation(),
				createResubscribeSession: mutation(),
				resumeSubscription: mutation(),
				syncStripeBilling: mutation(),
			},
		},
	};
});

describe('useOrganizationBilling', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('stops checkout polling once Stripe confirms the subscription', async () => {
		mocks.getStatus.mockResolvedValue({
			hasStripeSubscription: true,
			status: 'trialing',
			canManageBilling: false,
		});

		const { result } = renderHook(() => useOrganizationBilling({ checkout: 'success' }), { wrapper });

		expect(result.current.isCheckoutPolling).toBe(true);
		await waitFor(() => expect(result.current.isCheckoutPolling).toBe(false));
		expect(result.current.isCheckoutConfirmationDelayed).toBe(false);
		expect(result.current.checkoutFeedback).toBeNull();
	});

	it('uses the selected available plan when no Stripe subscription exists', async () => {
		const yearlyPlan = {
			key: 'cloud_yearly',
			name: 'nao Cloud',
			amount: 2_000_000,
			currency: 'usd',
			interval: 'year',
			intervalCount: 1,
		};
		mocks.getStatus.mockResolvedValue({
			hasStripeSubscription: false,
			plan: {
				key: 'cloud_monthly',
				name: 'nao Cloud',
				amount: 150_000,
				currency: 'usd',
				interval: 'month',
				intervalCount: 1,
			},
			availablePlans: {
				monthly: {
					key: 'cloud_monthly',
					name: 'nao Cloud',
					amount: 200_000,
					currency: 'usd',
					interval: 'month',
					intervalCount: 1,
				},
				yearly: yearlyPlan,
			},
			status: null,
			canManageBilling: true,
		});

		const { result } = renderHook(() => useOrganizationBilling({}), { wrapper });

		await waitFor(() => expect(result.current.billing.isSuccess).toBe(true));
		act(() => {
			result.current.setSelectedBillingInterval('yearly');
		});
		expect(result.current.plan).toEqual(yearlyPlan);
	});
});

function wrapper({ children }: { children: ReactNode }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
