// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OrganizationBillingSettings } from './organization-billing-settings';

import type { useOrganizationBilling } from '@/hooks/use-organization-billing';
import { getBillingStatusView, isHistoricalBillingStatus } from '@/lib/billing-display';

type BillingState = ReturnType<typeof useOrganizationBilling>;
type BillingData = NonNullable<BillingState['billing']['data']>;

const mocks = vi.hoisted(() => ({
	cancellationScheduled: false,
	hasStripeSubscription: false,
	isCheckoutPolling: false,
	invoiceHistoryAvailable: false,
	invoiceKind: 'subscription' as 'trial' | 'subscription' | 'no_charge',
	invoicePromotionCodes: [] as string[],
	invoiceTotal: 100_000,
	resubscribe: vi.fn(),
	selectedBillingInterval: 'monthly' as 'monthly' | 'yearly',
	setSelectedBillingInterval: vi.fn(),
	status: 'trialing' as BillingData['status'],
	trialAvailable: false,
	trialEndsAt: new Date('2026-10-08T00:00:00.000Z') as Date | null,
	trialStartedAt: new Date('2026-09-24T00:00:00.000Z') as Date | null,
	upcomingInvoice: null as {
		amountDue: number;
		currency: string;
		nextPaymentAt: Date;
		promotionCodes: string[];
	} | null,
	yearlyPlanAmount: 2_000_000,
}));

vi.mock('@/hooks/use-organization-billing', () => ({
	useOrganizationBilling: (): BillingState => billingState(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.cancellationScheduled = false;
	mocks.hasStripeSubscription = false;
	mocks.isCheckoutPolling = false;
	mocks.invoiceHistoryAvailable = false;
	mocks.invoiceKind = 'subscription';
	mocks.invoicePromotionCodes = [];
	mocks.invoiceTotal = 100_000;
	mocks.selectedBillingInterval = 'monthly';
	mocks.status = 'trialing';
	mocks.trialAvailable = false;
	mocks.trialEndsAt = new Date('2026-10-08T00:00:00.000Z');
	mocks.trialStartedAt = new Date('2026-09-24T00:00:00.000Z');
	mocks.upcomingInvoice = null;
	mocks.yearlyPlanAmount = 2_000_000;
});

afterEach(cleanup);

it('offers a paid recovery Checkout when a recorded trial has no Stripe subscription', () => {
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Subscribe in Stripe' }));

	expect(mocks.resubscribe).toHaveBeenCalledOnce();
	expect(screen.getByText('Already used')).toBeTruthy();
});

it('offers monthly and yearly choices when restarting a canceled subscription', () => {
	mocks.hasStripeSubscription = true;
	mocks.status = 'canceled';

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('button', { name: /Monthly/ }).getAttribute('aria-pressed')).toBe('true');
	expect(screen.getByRole('button', { name: /Yearly/ }).getAttribute('aria-pressed')).toBe('false');

	fireEvent.click(screen.getByRole('button', { name: /Yearly/ }));
	expect(mocks.setSelectedBillingInterval).toHaveBeenCalledWith('yearly');
});

it('uses neutral trial copy when billing history has no recorded trial', () => {
	mocks.status = 'incomplete_expired';
	mocks.trialEndsAt = null;
	mocks.trialStartedAt = null;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Unavailable')).toBeTruthy();
	expect(screen.queryByText('Already used')).toBeNull();
});

it('disables recovery Checkout while subscription confirmation is polling', () => {
	mocks.isCheckoutPolling = true;

	render(<OrganizationBillingSettings search={{}} />);

	const button = screen.getByRole('button', { name: 'Subscribe in Stripe' }) as HTMLButtonElement;
	expect(button.disabled).toBe(true);
	fireEvent.click(button);
	expect(mocks.resubscribe).not.toHaveBeenCalled();
});

it('shows a promotion code on the invoice it discounted', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoicePromotionCodes = ['EARLY50'];

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Code EARLY50')).toBeTruthy();
});

it('labels a zero-value follow-up invoice as no charge', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoiceKind = 'no_charge';
	mocks.invoiceTotal = 0;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('No charge')).toBeTruthy();
});

it('describes a trial invoice as a no-charge trial event', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoiceKind = 'trial';
	mocks.invoicePromotionCodes = ['EARLY50'];
	mocks.invoiceTotal = 0;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText(/No charge during trial/)).toBeTruthy();
	expect(screen.queryByText(/\$0 · Paid/)).toBeNull();
	expect(screen.queryByText('Code EARLY50')).toBeNull();
});

it('shows the Stripe-calculated next payment separately from the list price', () => {
	mocks.hasStripeSubscription = true;
	mocks.upcomingInvoice = {
		amountDue: 100_000,
		currency: 'usd',
		nextPaymentAt: new Date('2026-10-08T00:00:00.000Z'),
		promotionCodes: ['EARLY50'],
	};

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText(/\$2,000 per month, before discounts/)).toBeTruthy();
	expect(screen.getByText('Next payment estimate from Stripe')).toBeTruthy();
	expect(screen.getByText(/\$1,000 on/)).toBeTruthy();
	expect(screen.getByText('Code EARLY50')).toBeTruthy();
});

it('hides a cached payment estimate when the subscription will not renew', () => {
	mocks.cancellationScheduled = true;
	mocks.hasStripeSubscription = true;
	mocks.upcomingInvoice = {
		amountDue: 100_000,
		currency: 'usd',
		nextPaymentAt: new Date('2026-10-08T00:00:00.000Z'),
		promotionCodes: [],
	};

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.queryByText('Next payment estimate from Stripe')).toBeNull();
});

it('explains trial and recurring amounts before opening Stripe Checkout', () => {
	mocks.trialAvailable = true;
	mocks.trialEndsAt = null;
	mocks.trialStartedAt = null;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Due today')).toBeTruthy();
	expect(screen.getByText('No charge')).toBeTruthy();
	expect(screen.getByText(/Stripe applies promotion codes to the recurring price/)).toBeTruthy();
});

it('defaults to monthly and shows the Stripe-derived yearly discount before Checkout', () => {
	mocks.trialAvailable = true;
	mocks.trialEndsAt = null;
	mocks.trialStartedAt = null;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('button', { name: /Monthly/ }).getAttribute('aria-pressed')).toBe('true');
	expect(screen.getByRole('button', { name: /Yearly/ }).getAttribute('aria-pressed')).toBe('false');
	expect(screen.getByText(/\$20,000 per year/)).toBeTruthy();
	expect(screen.getByText(/\$1,666.67 per month equivalent · Save 16.67%/)).toBeTruthy();

	fireEvent.click(screen.getByRole('button', { name: /Yearly/ }));
	expect(mocks.setSelectedBillingInterval).toHaveBeenCalledWith('yearly');
});

it('does not claim savings when the yearly Price has no discount', () => {
	mocks.trialAvailable = true;
	mocks.trialEndsAt = null;
	mocks.trialStartedAt = null;
	mocks.yearlyPlanAmount = 2_400_000;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('$2,000 per month equivalent')).toBeTruthy();
	expect(screen.queryByText(/Save/)).toBeNull();
});

function billingState(): BillingState {
	const plan = {
		amount: 200_000,
		currency: 'usd',
		interval: 'month',
		intervalCount: 1,
		key: 'cloud_monthly_v2',
		name: 'nao Cloud',
		trialDays: 14,
		userLimit: null,
	} satisfies NonNullable<BillingState['plan']>;
	const yearlyPlan = {
		...plan,
		amount: mocks.yearlyPlanAmount,
		interval: 'year',
		key: 'cloud_yearly_v1',
	} as const;
	const data = {
		availablePlans: { monthly: plan, yearly: yearlyPlan },
		billingAccessEndsAt: null,
		canManageBilling: true,
		cancellationScheduled: mocks.cancellationScheduled,
		currentPeriodEndsAt: null,
		hasDefaultPaymentMethod: false,
		hasStripeSubscription: mocks.hasStripeSubscription,
		invoiceHistoryAvailable: mocks.invoiceHistoryAvailable,
		paymentMethodManagementAvailable: false,
		plan: mocks.hasStripeSubscription ? plan : null,
		planKey: mocks.hasStripeSubscription ? plan.key : null,
		portalAvailable: false,
		resubscribeAvailable:
			!mocks.hasStripeSubscription || mocks.status === 'canceled' || mocks.status === 'incomplete_expired',
		status: mocks.status,
		trialAvailable: mocks.trialAvailable,
		trialEndsAt: mocks.trialEndsAt,
		trialStartedAt: mocks.trialStartedAt,
	} satisfies BillingData;

	return {
		billing: {
			data,
			isError: false,
			isLoading: false,
		} as BillingState['billing'],
		canLoadUpcomingInvoice:
			data.canManageBilling === true &&
			data.hasStripeSubscription &&
			!data.cancellationScheduled &&
			(data.status === 'trialing' || data.status === 'active' || data.status === 'past_due'),
		checkoutFeedback: null,
		hasStripeSubscription: mocks.hasStripeSubscription,
		invoices: {
			data: mocks.invoiceHistoryAvailable
				? [
						{
							id: 'in_cloud',
							number: 'NAO-0001',
							invoiceKind: mocks.invoiceKind,
							promotionCodes: mocks.invoicePromotionCodes,
							status: 'paid',
							createdAt: new Date('2026-10-01T00:00:00.000Z'),
							total: mocks.invoiceTotal,
							currency: 'usd',
							hostedInvoiceUrl: null,
							invoicePdf: null,
						},
					]
				: [],
			isError: false,
			isLoading: false,
		} as BillingState['invoices'],
		upcomingInvoice: {
			data: mocks.upcomingInvoice,
			isError: false,
			isLoading: false,
		} as BillingState['upcomingInvoice'],
		isBillingSyncPending: false,
		isCheckoutConfirmationDelayed: false,
		isCheckoutPolling: mocks.isCheckoutPolling,
		isEndingAtPeriodEnd: data.cancellationScheduled && (data.status === 'active' || data.status === 'trialing'),
		isHistoricalSubscription: isHistoricalBillingStatus(mocks.status),
		isPaymentMethodPortalPending: false,
		isPortalPending: false,
		isResubscribePending: false,
		isResumePending: false,
		isTrialCheckoutPending: false,
		managementError: null,
		openPaymentMethodPortal: vi.fn(),
		openPortal: vi.fn(),
		openTrialCheckout: vi.fn(),
		plan,
		portalFeedback: null,
		resubscribe: mocks.resubscribe,
		selectedBillingInterval: mocks.selectedBillingInterval,
		setSelectedBillingInterval: mocks.setSelectedBillingInterval,
		resume: vi.fn(),
		retryCheckoutConfirmation: vi.fn(),
		status: mocks.status,
		statusView: getBillingStatusView(mocks.status, false, false),
		syncBilling: vi.fn(),
		trialCheckoutError: null,
	} satisfies BillingState;
}
