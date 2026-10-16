// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreditTopUp } from './use-credit-top-up';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(async () => undefined),
	mutate: vi.fn(),
	refetch: vi.fn(),
	statusData: undefined as { credited: boolean } | undefined,
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ error: null, isPending: false, mutate: mocks.mutate }),
	useQuery: () => ({ data: mocks.statusData, refetch: mocks.refetch }),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/main', () => ({
	trpc: {
		account: {
			getManagedCreditStatus: { queryKey: () => ['managed-credit-status'] },
			getCreditSummary: { queryKey: () => ['credit-summary'] },
			listCreditLedger: { queryKey: () => ['credit-ledger'] },
			listManagedAiUsage: { queryKey: () => ['managed-ai-usage'] },
		},
		billing: {
			createCreditTopUpCheckoutSession: { mutationOptions: (options: object) => options },
			getCreditTopUpStatus: { queryOptions: () => ({}) },
			getInvoices: { queryKey: () => ['invoices'] },
		},
		project: {
			listAvailableTranscribeModels: { queryKey: () => ['transcribe-models'] },
			getDefaultChatModel: { queryKey: () => ['default-chat-model'] },
		},
	},
}));

describe('useCreditTopUp', () => {
	beforeEach(() => {
		mocks.statusData = undefined;
		mocks.invalidateQueries.mockClear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('refreshes wallet data when confirmation arrives after polling times out', () => {
		const { result, rerender } = renderHook(() => useCreditTopUp('cs_test'));

		act(() => vi.advanceTimersByTime(15_000));
		expect(result.current.showRetry).toBe(true);

		act(() => {
			mocks.statusData = { credited: true };
			rerender();
		});

		expect(result.current.feedback).toBe('Credits were added to the organization wallet.');
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-summary'] });
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-ledger'] });
	});

	it('starts polling when the Checkout Session changes after a timeout', () => {
		const { result, rerender } = renderHook(({ checkoutSessionId }) => useCreditTopUp(checkoutSessionId), {
			initialProps: { checkoutSessionId: 'cs_first' },
		});

		act(() => vi.advanceTimersByTime(15_000));
		expect(result.current.showRetry).toBe(true);

		rerender({ checkoutSessionId: 'cs_second' });

		expect(result.current.feedback).toBe('Confirming your credit purchase with Stripe…');
		expect(result.current.showRetry).toBe(false);
	});
});
