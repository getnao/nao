// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';
import type { ReactNode } from 'react';
import { useConfirmCloudBillingChange, useOrganizationBilling } from '@/hooks/use-organization-billing';

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	getStatusInput: vi.fn(),
	mutationInput: vi.fn(),
	mutationResults: {} as Record<string, unknown>,
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
				return name in mocks.mutationResults
					? Promise.resolve(mocks.mutationResults[name])
					: new Promise<never>(() => {});
			},
			...options,
		}),
	});
	const mutations = [
		'createTrialCheckoutSession',
		'createPortalSession',
		'createPaymentMethodSession',
		'createResubscribeSession',
		'resumeSubscription',
		'syncStripeBilling',
		'previewChange',
		'confirmChange',
		'selectSeats',
		'switchToFree',
		'keepPlan',
		'cancelPendingChange',
	];
	return {
		trpc: {
			billing: {
				getStatus: query('getStatus', mocks.getStatus),
				getInvoices: query('getInvoices', async () => []),
				getUpcomingInvoice: query('getUpcomingInvoice', async () => null),
				getAccess: query('getAccess', async () => null),
				...Object.fromEntries(mutations.map((name) => [name, mutation(name)])),
			},
			organization: {
				getMembers: query('getMembers', async () => []),
				getUserCounts: query('getUserCounts', async () => null),
			},
		},
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	mocks.mutationResults = {};
	window.location.hash = '';
});

describe('useOrganizationBilling', () => {
	it('stops checkout polling once Stripe confirms the subscription', async () => {
		mocks.getStatus.mockResolvedValue({ hasStripeSubscription: true, paidPlanSelected: true, status: 'trialing' });

		const { result } = renderHook(() => useOrganizationBilling({ checkout: 'success' }), { wrapper });

		expect(result.current.isCheckoutPolling).toBe(true);
		await waitFor(() => expect(result.current.isCheckoutPolling).toBe(false));
		expect(result.current.isCheckoutConfirmationDelayed).toBe(false);
		expect(result.current.checkoutFeedback).toBeNull();
	});

	it.each([
		[{ trialAvailable: true }, 'createTrialCheckoutSession'],
		[{ trialAvailable: false, needsPaidPlanSelection: false }, 'createResubscribeSession'],
	])('sends the chosen plan, seats and browser currency to Checkout (%o)', async (billing, mutation) => {
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['not a locale']);
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('en_FR');
		mocks.getStatus.mockResolvedValue({ hasStripeSubscription: false, status: null, ...billing });

		const { result } = renderHook(() => useOrganizationBilling({}), { wrapper });

		await waitFor(() => expect(result.current.billing.isSuccess).toBe(true));
		expect(mocks.getStatusInput).toHaveBeenCalledWith({ currency: 'eur' });
		act(() => {
			void result.current.startCheckout('cloud_team_yearly_v1', 5);
		});
		await waitFor(() =>
			expect(mocks.mutationInput).toHaveBeenCalledWith(mutation, {
				planKey: 'cloud_team_yearly_v1',
				seats: 5,
				currency: 'eur',
			}),
		);
	});
});

describe('useConfirmCloudBillingChange', () => {
	it('sends the admin to the Stripe invoice instead of refreshing when payment is pending', async () => {
		mocks.mutationResults.confirmChange = { status: 'payment_pending', hostedInvoiceUrl: '#invoice' };
		const onCompleted = vi.fn().mockResolvedValue(undefined);

		const { result } = renderHook(() => useConfirmCloudBillingChange(onCompleted), { wrapper });
		await act(() => result.current.mutateAsync({ previewToken: 'token', requestId: 'request' }));

		expect(window.location.hash).toBe('#invoice');
		expect(onCompleted).not.toHaveBeenCalled();
	});
});

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}
