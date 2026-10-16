// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedAiChargesContent, OrganizationCreditsContent } from './credits-wallet-content';
import type { AnchorHTMLAttributes } from 'react';

const mocks = vi.hoisted(() => ({
	getSummary: vi.fn(),
	listLedger: vi.fn(),
	listUsage: vi.fn(),
	createCheckout: vi.fn(),
	getCheckoutStatus: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		account: {
			getCreditSummary: {
				queryOptions: () => ({ queryKey: ['credit-summary'], queryFn: mocks.getSummary }),
				queryKey: () => ['credit-summary'],
			},
			getManagedCreditStatus: { queryKey: () => ['managed-credit-status'] },
			listCreditLedger: {
				queryOptions: () => ({ queryKey: ['credit-ledger'], queryFn: mocks.listLedger }),
				queryKey: () => ['credit-ledger'],
			},
			listManagedAiUsage: {
				queryOptions: () => ({ queryKey: ['managed-ai-usage'], queryFn: mocks.listUsage }),
				queryKey: () => ['managed-ai-usage'],
			},
		},
		billing: {
			createCreditTopUpCheckoutSession: {
				mutationOptions: (options: object) => ({
					mutationFn: mocks.createCheckout,
					...options,
				}),
			},
			getCreditTopUpStatus: {
				queryOptions: () => ({
					queryKey: ['credit-top-up-status'],
					queryFn: mocks.getCheckoutStatus,
				}),
			},
			getInvoices: { queryKey: () => ['invoices'] },
		},
		project: {
			listAvailableTranscribeModels: { queryKey: () => ['available-models'] },
			getDefaultChatModel: { queryKey: () => ['default-chat-model'] },
		},
	},
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, 'aria-label': ariaLabel }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href='#replay' aria-label={ariaLabel}>
			{children}
		</a>
	),
}));

describe('credit settings content', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('shows organization wallet totals to admins', async () => {
		mocks.getSummary.mockResolvedValue({
			balanceMicroUsd: 23_000_000,
			lifetimeCreditedMicroUsd: 25_000_000,
			lifetimeDebitedMicroUsd: 2_000_000,
			enabled: true,
		});
		mocks.listLedger.mockResolvedValue({
			groups: [
				{
					id: 'gift',
					createdAt: new Date(),
					grantedForUserName: 'Managed User',
					usageUserName: null,
					entries: [
						{
							entryType: 'gift',
							deltaMicroUsd: 5_000_000,
							balanceAfterMicroUsd: 5_000_000,
							transactionSequence: 1,
							metadata: { grantType: 'user_join' },
						},
					],
				},
				{
					id: 'setup-gift',
					createdAt: new Date(),
					grantedForUserName: null,
					usageUserName: null,
					entries: [
						{
							entryType: 'gift',
							deltaMicroUsd: 20_000_000,
							balanceAfterMicroUsd: 25_000_000,
							transactionSequence: 2,
							metadata: { grantType: 'organization_setup' },
						},
					],
				},
				{
					id: 'run',
					createdAt: new Date(),
					grantedForUserName: null,
					usageUserName: 'Managed User',
					entries: [
						{
							entryType: 'usage',
							deltaMicroUsd: -1_000_000,
							balanceAfterMicroUsd: 23_000_000,
							transactionSequence: 5,
						},
						{
							entryType: 'usage',
							deltaMicroUsd: -1_000_000,
							balanceAfterMicroUsd: 24_000_000,
							transactionSequence: 3,
						},
					],
				},
			],
			nextCursor: null,
		});
		renderOrganizationCreditsContent();

		await screen.findByText('Available');
		expect(
			await screen.findByText(
				(_, element) =>
					element?.tagName === 'TD' && element.textContent?.trim() === '$5 member join grant Managed User',
			),
		).toBeTruthy();
		expect(
			await screen.findByText(
				(_, element) => element?.tagName === 'TD' && element.textContent?.trim() === '$20 project setup grant',
			),
		).toBeTruthy();
		expect(
			await screen.findByText(
				(_, element) =>
					element?.tagName === 'TD' && element.textContent?.trim() === 'nao AI - Managed User 2 calls',
			),
		).toBeTruthy();
		expect(
			screen.getByText((_, element) => element?.tagName === 'TD' && element.textContent?.trim() === '$23.00'),
		).toBeTruthy();
		expect(screen.getByRole('link', { name: 'More details' })).toBeTruthy();
		expect(screen.queryByText(/You gave your \$5 welcome credit/)).toBeNull();
	});

	it('shows nao AI usage details and replay links', async () => {
		mocks.listUsage.mockResolvedValue({
			runs: [
				{
					id: 'run',
					startedAt: new Date(),
					chatTitle: 'Sales analysis',
					userName: 'Managed User',
					events: [
						{
							id: 'usage',
							chatId: 'chat-1',
							category: 'chat',
							llmModelId: 'gpt-5.6',
							llmProvider: 'nao',
							status: 'completed',
							costSource: 'price_book',
							totalTokens: 100,
							upstreamCostMicroUsd: 1_000,
							customerChargeMicroUsd: 2_000,
						},
					],
				},
			],
			nextCursor: null,
		});

		renderManagedAiChargesContent(true);

		expect(await screen.findByText('Your model calls paid with nao credits.')).toBeTruthy();
		expect(await screen.findByText(/Managed User · .* · gpt-5\.6/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Open chat replay' })).toBeTruthy();
	});

	it('distinguishes failed and aborted runs from mixed runs', async () => {
		mocks.getSummary.mockResolvedValue({ enabled: false });
		mocks.listUsage.mockResolvedValue({
			runs: [
				usageRun('failed', ['failed', 'failed']),
				usageRun('aborted', ['aborted', 'aborted']),
				usageRun('partially-failed', ['completed', 'failed']),
				usageRun('partially-aborted', ['completed', 'aborted']),
			],
			nextCursor: null,
		});

		renderManagedAiChargesContent(true);

		expect(await screen.findByText(/^Failed/)).toBeTruthy();
		expect(screen.getByText(/^Aborted/)).toBeTruthy();
		expect(screen.getByText(/^Partially failed/)).toBeTruthy();
		expect(screen.getByText(/^Partially aborted/)).toBeTruthy();
	});

	it('does not offer older pages before cursors load', async () => {
		mocks.getSummary.mockResolvedValue({
			balanceMicroUsd: 0,
			lifetimeCreditedMicroUsd: 0,
			lifetimeDebitedMicroUsd: 0,
			enabled: true,
		});
		mocks.listLedger.mockReturnValue(new Promise(() => undefined));

		renderOrganizationCreditsContent();

		await screen.findByText('Available');
		expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
	});

	it('shows wallet activity without offering top-ups in read-only mode', async () => {
		mocks.getSummary.mockResolvedValue({
			balanceMicroUsd: 23_000_000,
			lifetimeCreditedMicroUsd: 25_000_000,
			lifetimeDebitedMicroUsd: 2_000_000,
			enabled: true,
		});
		mocks.listLedger.mockResolvedValue({
			groups: [
				{
					id: 'gift',
					createdAt: new Date(),
					grantedForUserName: 'Managed User',
					usageUserName: null,
					entries: [
						{
							entryType: 'gift',
							deltaMicroUsd: 5_000_000,
							balanceAfterMicroUsd: 23_000_000,
							transactionSequence: 1,
							metadata: { grantType: 'user_join' },
						},
					],
				},
			],
			nextCursor: null,
		});

		renderOrganizationCreditsContent(undefined, false);

		expect(
			await screen.findByText(
				(_, element) =>
					element?.tagName === 'TD' && element.textContent?.trim() === '$5 member join grant Managed User',
			),
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Add credits' })).toBeNull();
	});

	it('shows the platform fee and starts Checkout with the selected USD credits', async () => {
		mocks.getSummary.mockResolvedValue({
			balanceMicroUsd: 0,
			lifetimeCreditedMicroUsd: 0,
			lifetimeDebitedMicroUsd: 0,
			enabled: true,
		});
		mocks.listLedger.mockResolvedValue({ groups: [], nextCursor: null });
		mocks.createCheckout.mockReturnValue(new Promise(() => undefined));

		renderOrganizationCreditsContent();

		expect(screen.queryByText('Purchase summary')).toBeNull();
		fireEvent.click(await screen.findByRole('button', { name: 'Add credits' }));
		expect(await screen.findByText('nao platform fee (5%)')).toBeTruthy();
		const amountInput = screen.getByLabelText('Credit amount') as HTMLInputElement;
		expect(amountInput.type).toBe('text');
		expect(amountInput.inputMode).toBe('decimal');
		expect(screen.queryByText('$', { exact: true })).toBeNull();
		expect(screen.getByText('$1.00')).toBeTruthy();
		fireEvent.change(amountInput, { target: { value: '30' } });
		fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));

		await waitFor(() => expect(mocks.createCheckout).toHaveBeenCalled());
		expect(mocks.createCheckout.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ creditAmountCents: 3_000 }));
	});

	it('confirms the purchase outside the closed credit dialog after returning from Stripe', async () => {
		mocks.getSummary.mockResolvedValue({
			balanceMicroUsd: 0,
			lifetimeCreditedMicroUsd: 0,
			lifetimeDebitedMicroUsd: 0,
			enabled: true,
		});
		mocks.listLedger.mockResolvedValue({ groups: [], nextCursor: null });
		mocks.getCheckoutStatus.mockReturnValue(new Promise(() => undefined));

		renderOrganizationCreditsContent('cs_test');

		await screen.findByRole('button', { name: 'Add credits' });
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('Confirming your credit purchase with Stripe…')).toBeTruthy();
	});
});

function usageRun(id: string, statuses: ('completed' | 'failed' | 'aborted')[]) {
	return {
		id,
		startedAt: new Date(),
		chatTitle: id,
		userName: 'Managed User',
		events: statuses.map((status, index) => ({
			id: `${id}-${index}`,
			chatId: null,
			category: 'chat',
			llmModelId: 'gpt-5.6',
			llmProvider: 'nao',
			status,
			costSource: status === 'completed' ? 'price_book' : 'estimated',
			totalTokens: 0,
			upstreamCostMicroUsd: 0,
			customerChargeMicroUsd: 0,
		})),
	};
}

function renderOrganizationCreditsContent(creditCheckout?: string, canTopUp = true) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<OrganizationCreditsContent creditCheckout={creditCheckout} canTopUp={canTopUp} />
		</QueryClientProvider>,
	);
}

function renderManagedAiChargesContent(canViewReplay: boolean) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<ManagedAiChargesContent canViewReplay={canViewReplay} />
		</QueryClientProvider>,
	);
}
