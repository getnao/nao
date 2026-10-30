// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationBilling } from './use-organization-billing';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	getStatusInput: vi.fn(),
	mutationInput: vi.fn(),
	syncStripeBilling: vi.fn(async () => ({ synced: true })),
}));

vi.mock('@/main', () => {
	const query = (name: string, queryFn: () => Promise<unknown>) => ({
		queryKey: () => [['billing', name]],
		queryOptions: (input?: unknown) => {
			if (name === 'getStatus') {
				mocks.getStatusInput(input);
			}
			return { queryKey: [['billing', name], input], queryFn };
		},
	});
	const mutation = (name: string) => ({
		mutationOptions: (options: object) => ({
			mutationFn: (input: unknown) => {
				mocks.mutationInput(name, input);
				if (name === 'syncStripeBilling') {
					return mocks.syncStripeBilling();
				}
				return new Promise<never>(() => {});
			},
			...options,
		}),
	});
	return {
		trpc: {
			billing: {
				getStatus: query('getStatus', mocks.getStatus),
				getInvoices: query('getInvoices', async () => []),
				getUpcomingInvoice: query('getUpcomingInvoice', async () => null),
				getAccess: query('getAccess', async () => null),
				createTrialCheckoutSession: mutation('createTrialCheckoutSession'),
				createPortalSession: mutation('createPortalSession'),
				createPaymentMethodSession: mutation('createPaymentMethodSession'),
				createResubscribeSession: mutation('createResubscribeSession'),
				resumeSubscription: mutation('resumeSubscription'),
				syncStripeBilling: mutation('syncStripeBilling'),
				previewSeatChange: mutation('previewSeatChange'),
				changeSeatQuantity: mutation('changeSeatQuantity'),
				previewPlanChange: mutation('previewPlanChange'),
				changePlan: mutation('changePlan'),
				selectSeats: mutation('selectSeats'),
				switchToFree: mutation('switchToFree'),
				keepPlan: mutation('keepPlan'),
				cancelPendingPlanChange: mutation('cancelPendingPlanChange'),
			},
			organization: {
				getMembers: query('getMembers', async () => []),
				getUserCounts: query('getUserCounts', async () => ({})),
			},
			project: {
				listAllUsersWithRoles: query('listAllUsersWithRoles', async () => []),
			},
		},
	};
});

describe('useOrganizationBilling', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('stops checkout polling once Stripe confirms the subscription', async () => {
		mocks.getStatus.mockResolvedValue({
			hasStripeSubscription: true,
			paidPlanSelected: true,
			status: 'trialing',
			canManageBilling: false,
		});

		const { result } = renderHook(() => useOrganizationBilling({ checkout: 'success' }), { wrapper });

		expect(result.current.isCheckoutPolling).toBe(true);
		await waitFor(() => expect(result.current.isCheckoutPolling).toBe(false));
		expect(result.current.isCheckoutConfirmationDelayed).toBe(false);
		expect(result.current.checkoutFeedback).toBeNull();
	});

	it('reconciles directly with Stripe after Checkout before paid management is available', async () => {
		mocks.getStatus.mockResolvedValue({
			access: { freeTierEnabled: true },
			hasStripeSubscription: false,
			paidPlanSelected: false,
			paymentMethodManagementAvailable: false,
			status: null,
			canManageBilling: true,
		});

		renderHook(() => useOrganizationBilling({ checkout: 'success', checkoutPlan: 'team' }), { wrapper });

		await waitFor(() => expect(mocks.syncStripeBilling).toHaveBeenCalledOnce());
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

	it('uses the first valid browser locale for plans and Checkout', async () => {
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['not a locale']);
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('en_FR');
		mocks.getStatus.mockResolvedValue({
			hasStripeSubscription: false,
			status: null,
			canManageBilling: true,
		});

		const { result } = renderHook(() => useOrganizationBilling({}), { wrapper });

		await waitFor(() => expect(result.current.billing.isSuccess).toBe(true));
		expect(mocks.getStatusInput).toHaveBeenCalledWith({ currency: 'eur' });
		act(() => {
			result.current.openTrialCheckout();
		});
		await waitFor(() =>
			expect(mocks.mutationInput).toHaveBeenCalledWith('createTrialCheckoutSession', {
				billingInterval: 'monthly',
				currency: 'eur',
			}),
		);
	});

	it('submits the backend plan key for Free-tier Checkout', async () => {
		mocks.getStatus.mockResolvedValue({
			access: { freeTierEnabled: true },
			availablePlans: [],
			hasStripeSubscription: false,
			paidPlanSelected: false,
			trialAvailable: true,
			status: null,
			canManageBilling: true,
		});
		const { result } = renderHook(() => useOrganizationBilling({}), { wrapper });

		await waitFor(() => expect(result.current.billing.isSuccess).toBe(true));
		act(() => {
			result.current.openTrialCheckoutForPlan('cloud_team_monthly_v1');
		});

		await waitFor(() =>
			expect(mocks.mutationInput).toHaveBeenCalledWith('createTrialCheckoutSession', {
				planKey: 'cloud_team_monthly_v1',
				currency: expect.any(String),
			}),
		);
	});
});

function wrapper({ children }: { children: ReactNode }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
