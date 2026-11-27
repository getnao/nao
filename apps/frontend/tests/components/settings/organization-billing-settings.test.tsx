// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { CloudBillingStatus, OrganizationBillingState } from '@/hooks/use-organization-billing';
import { OrganizationBillingSettings } from '@/components/settings/organization-billing-settings';

const mocks = vi.hoisted(() => ({
	data: undefined as unknown as CloudBillingStatus,
	invoiceKind: 'subscription' as 'trial' | 'subscription' | 'no_charge' | 'credit_top_up',
	startCheckout: vi.fn(),
	previewChange: vi.fn(),
	confirmChange: vi.fn(),
	selectSeats: vi.fn(),
	switchToFree: vi.fn(),
	cancelPendingChange: vi.fn(),
}));

vi.mock('@/hooks/use-organization-billing', () => ({
	useOrganizationBilling: (): OrganizationBillingState => billingState(),
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ canViewChatReplay: true }),
}));

vi.mock('@/components/settings/credits-wallet-content', () => ({
	OrganizationCreditsContent: () => null,
}));

const admin = { id: 'admin', name: 'Ada Admin', email: 'ada@example.com', membershipClass: 'org_admin' as const };
const member = (id: string, seated: boolean) => ({
	id,
	name: `Member ${id}`,
	email: `${id}@example.com`,
	membershipClass: 'org_member' as const,
	seated,
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.invoiceKind = 'subscription';
	mocks.startCheckout.mockResolvedValue(undefined);
	mocks.selectSeats.mockResolvedValue(undefined);
	mocks.switchToFree.mockResolvedValue(undefined);
	mocks.confirmChange.mockResolvedValue({ status: 'completed' });
	mocks.data = status();
});

afterEach(cleanup);

it('asks for Team seats before sending an organization without a plan to Checkout', async () => {
	mocks.data = status({
		members: [{ ...admin, seated: true }, ...['a', 'b', 'c', 'd', 'e'].map((id) => member(id, true))],
	});
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Team' }));
	const seats = screen.getByLabelText('Paid seats') as HTMLInputElement;
	expect(seats.value).toBe('6');
	fireEvent.change(seats, { target: { value: '5' } });
	expect(screen.getByText(/1 person with full access will become/)).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));

	await waitFor(() => expect(mocks.startCheckout).toHaveBeenCalledWith('cloud_team_monthly_v1', 5));
});

it('sends Unlimited straight to Checkout when no plan exists', () => {
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Unlimited' }));

	expect(mocks.startCheckout).toHaveBeenCalledWith('cloud_unlimited_monthly_v1');
});

it('only confirms a plan change after Stripe totals were reviewed', async () => {
	mocks.data = paidTeam();
	mocks.previewChange.mockResolvedValue(preview({ readOnlyUsersAfterChange: [] }));
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Unlimited' }));
	expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));

	expect(mocks.previewChange).toHaveBeenCalledWith('cloud_unlimited_monthly_v1', undefined, undefined);
	await waitFor(() => expect(mocks.confirmChange).toHaveBeenCalledWith('preview-token'));
});

it('asks for a new review when the seat count changes after a preview', async () => {
	mocks.data = paidTeam();
	mocks.previewChange.mockResolvedValue(
		preview({ readOnlyUsersAfterChange: [{ id: 'b', name: 'B', email: 'b@x.io' }] }),
	);
	render(<OrganizationBillingSettings search={{ tab: 'seats' }} />);

	fireEvent.click(screen.getByRole('button', { name: 'Adjust seats' }));
	const seats = screen.getByLabelText('Paid seats') as HTMLInputElement;
	expect(seats.value).toBe('4');
	fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
	expect(await screen.findByText(/1 person with full access will become/)).toBeTruthy();
	fireEvent.change(seats, { target: { value: '6' } });

	expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
	expect(mocks.previewChange).toHaveBeenCalledWith('cloud_team_monthly_v1', 4, undefined);
});

it('moves a seat to another member while keeping organization admins seated', async () => {
	mocks.data = status({
		tier: 'free',
		seatLimit: 3,
		members: [{ ...admin, seated: true }, member('a', true), member('b', false)],
	});
	render(<OrganizationBillingSettings search={{ tab: 'seats' }} />);

	expect((screen.getByRole('switch', { name: 'Full access for Ada Admin' }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	fireEvent.click(screen.getByRole('switch', { name: 'Full access for Member b' }));
	await waitFor(() => expect(mocks.selectSeats).toHaveBeenCalledWith(['a', 'b']));

	fireEvent.click(screen.getByRole('switch', { name: 'Full access for Member a' }));
	await waitFor(() => expect(mocks.selectSeats).toHaveBeenLastCalledWith([]));
});

it('refuses to seat someone when every seat is in use', () => {
	mocks.data = status({
		tier: 'free',
		seatLimit: 3,
		members: [{ ...admin, seated: true }, member('a', true), member('b', true), member('c', false)],
	});
	render(<OrganizationBillingSettings search={{ tab: 'seats' }} />);

	fireEvent.click(screen.getByRole('switch', { name: 'Full access for Member c' }));

	expect(screen.getByRole('alert').textContent).toMatch(/No seats are available/);
	expect(mocks.selectSeats).not.toHaveBeenCalled();
});

it('keeps admins and up to the Free limit seated when switching to Free', async () => {
	mocks.data = paidTeam({
		members: [{ ...admin, seated: true }, member('a', true), member('b', true), member('c', true)],
	});
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Switch to Free' }));
	expect((screen.getByRole('checkbox', { name: 'Keep Member c seated on Free' }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	fireEvent.click(screen.getByRole('button', { name: 'Confirm switch to Free' }));

	await waitFor(() => expect(mocks.switchToFree).toHaveBeenCalledWith(['a', 'b']));
});

it('blocks new plan choices until a scheduled change is canceled', () => {
	mocks.data = paidTeam({
		pending: { planKey: 'cloud_team_monthly_v1', seats: 4, effectiveAt: new Date('2099-01-01T00:00:00.000Z') },
		seatQuantity: 6,
	});
	render(<OrganizationBillingSettings search={{}} />);

	expect((screen.getByRole('button', { name: 'Choose Unlimited' }) as HTMLButtonElement).disabled).toBe(true);
	expect(screen.getByText(/Renews with 4 seats/)).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Cancel change' }));
	expect(mocks.cancelPendingChange).toHaveBeenCalledOnce();
});

it.each([
	['subscription', 'Team'],
	['no_charge', 'No charge'],
	['trial', 'Trial'],
] as const)('labels a %s invoice as %s', (invoiceKind, label) => {
	mocks.invoiceKind = invoiceKind;
	mocks.data = paidTeam({ invoiceHistoryAvailable: true });
	render(<OrganizationBillingSettings search={{ tab: 'invoices' }} />);

	expect(screen.getByText(label)).toBeTruthy();
});

function status(overrides: Partial<CloudBillingStatus> = {}): CloudBillingStatus {
	return {
		currency: 'usd',
		plan: null,
		seatQuantity: null,
		pending: null,
		pendingFreeSeatUserIds: null,
		tier: 'free',
		seatLimit: 3,
		members: [{ ...admin, seated: true }],
		recommendation: 'team',
		status: null,
		trialStartedAt: new Date('2026-09-24T00:00:00.000Z'),
		trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
		currentPeriodStartsAt: null,
		currentPeriodEndsAt: null,
		cancellationScheduled: false,
		hasDefaultPaymentMethod: null,
		billingAccessEndsAt: null,
		trialAvailable: false,
		needsPaidPlanSelection: false,
		paidPlanSelected: false,
		portalAvailable: false,
		invoiceHistoryAvailable: false,
		paymentMethodManagementAvailable: false,
		resubscribeAvailable: true,
		hasStripeSubscription: false,
		...overrides,
	};
}

function paidTeam(overrides: Partial<CloudBillingStatus> = {}): CloudBillingStatus {
	return status({
		plan: {
			key: 'cloud_team_monthly_v1',
			tier: 'team',
			interval: 'monthly',
			amount: 5_000,
			currency: 'usd',
			legacy: false,
		},
		seatQuantity: 4,
		tier: 'team',
		seatLimit: 4,
		members: [{ ...admin, seated: true }, member('a', true), member('b', true)],
		status: 'active',
		currentPeriodEndsAt: new Date('2099-01-01T00:00:00.000Z'),
		paidPlanSelected: true,
		hasStripeSubscription: true,
		resubscribeAvailable: false,
		...overrides,
	});
}

function preview(overrides: Partial<Awaited<ReturnType<OrganizationBillingState['previewChange']>>>) {
	return {
		amountDue: 195_000,
		subtotal: 195_000,
		tax: 0,
		discount: 0,
		currency: 'usd',
		lines: [],
		previewToken: 'preview-token',
		expiresAt: new Date(Date.now() + 300_000),
		effective: 'immediate' as const,
		effectiveAt: new Date(),
		firstChargeAt: null,
		targetPlanKey: 'cloud_unlimited_monthly_v1' as const,
		seats: null,
		readOnlyUsersAfterChange: [],
		promotionCodeDiscount: null,
		...overrides,
	};
}

function billingState(): OrganizationBillingState {
	const data = mocks.data;
	const query = <T,>(value: T) => ({ data: value, isError: false, isLoading: false }) as never;
	return {
		billing: query(data),
		invoices: query(
			data.invoiceHistoryAvailable
				? [
						{
							id: 'in_cloud',
							number: 'NAO-0001',
							invoiceKind: mocks.invoiceKind,
							planTier: 'team',
							promotionCodes: [],
							status: 'paid',
							createdAt: new Date('2026-10-01T00:00:00.000Z'),
							total: 20_000,
							currency: 'usd',
							hostedInvoiceUrl: null,
							invoicePdf: null,
						},
					]
				: [],
		),
		upcomingInvoice: query(null),
		canLoadUpcomingInvoice: false,
		status: data.status,
		paidPlanSelected: data.paidPlanSelected,
		isHistoricalSubscription: false,
		selectedBillingInterval: 'monthly',
		setSelectedBillingInterval: vi.fn(),
		billingCurrency: data.currency ?? 'usd',
		isBillingCurrencyLocked: data.currency !== null,
		setSelectedBillingCurrency: vi.fn(),
		isCheckoutPolling: false,
		isCheckoutConfirmationDelayed: false,
		checkoutFeedback: null,
		portalFeedback: null,
		syncError: null,
		checkoutError: null,
		managementError: null,
		isCheckoutPending: false,
		isPortalPending: false,
		isPaymentMethodPortalPending: false,
		isResumePending: false,
		isBillingSyncPending: false,
		isCommandPending: false,
		startCheckout: mocks.startCheckout,
		previewChange: mocks.previewChange,
		confirmChange: mocks.confirmChange,
		selectSeats: mocks.selectSeats,
		switchToFree: mocks.switchToFree,
		keepPlan: vi.fn(),
		cancelPendingChange: mocks.cancelPendingChange,
		openPortal: vi.fn(),
		openPaymentMethodPortal: vi.fn(),
		resume: vi.fn(),
		syncBilling: vi.fn(),
		retryCheckoutConfirmation: vi.fn(),
	};
}
