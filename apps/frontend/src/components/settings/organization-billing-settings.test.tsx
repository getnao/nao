// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { isTerminalBillingStatus } from '@nao/shared/billing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OrganizationBillingSettings } from './organization-billing-settings';

import type * as ReactRouter from '@tanstack/react-router';
import type { CloudSeatCandidate } from '@/components/settings/cloud-billing-seats-card';
import type { useOrganizationBilling } from '@/hooks/use-organization-billing';
import { formatBillingDate, getBillingStatusView } from '@/lib/billing-display';

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
	paymentMethodManagementAvailable: false,
	portalAvailable: false,
	freeTierEnabled: false,
	cloudTrialActive: false,
	cloudPaidPlanSelected: true,
	cloudCancellationScheduled: false,
	cloudSeatUserCount: 4,
	cloudSeatQuantity: 4,
	cloudSeatCandidates: [] as CloudSeatCandidate[],
	cloudSaveSeatSelection: vi.fn(),
	cloudKeepPlan: vi.fn(),
	cloudOpenTrialCheckoutForPlan: vi.fn(),
	cloudConfirmPlanChange: vi.fn(),
	cloudPreviewPlanChange: vi.fn(),
	localTrialActive: false,
	openPaymentMethodPortal: vi.fn(),
	openPortal: vi.fn(),
	openTrialCheckout: vi.fn(),
	resubscribe: vi.fn(),
	selectedBillingInterval: 'monthly' as 'monthly' | 'yearly',
	setSelectedBillingInterval: vi.fn(),
	stripeTrialPlaceholder: false,
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

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => ({ canViewChatReplay: true }),
}));

vi.mock('@/components/settings/credits-wallet-content', () => ({
	OrganizationCreditsContent: () => null,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof ReactRouter>()),
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'ResizeObserver',
		vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
	);
	mocks.cancellationScheduled = false;
	mocks.hasStripeSubscription = false;
	mocks.isCheckoutPolling = false;
	mocks.invoiceHistoryAvailable = false;
	mocks.invoiceKind = 'subscription';
	mocks.invoicePromotionCodes = [];
	mocks.invoiceTotal = 100_000;
	mocks.paymentMethodManagementAvailable = false;
	mocks.portalAvailable = false;
	mocks.freeTierEnabled = false;
	mocks.cloudTrialActive = false;
	mocks.cloudPaidPlanSelected = true;
	mocks.cloudCancellationScheduled = false;
	mocks.cloudSeatUserCount = 4;
	mocks.cloudSeatQuantity = 4;
	mocks.cloudSeatCandidates = [];
	mocks.cloudSaveSeatSelection.mockReset();
	mocks.cloudKeepPlan.mockReset();
	mocks.cloudOpenTrialCheckoutForPlan.mockReset();
	mocks.cloudConfirmPlanChange.mockReset();
	mocks.cloudPreviewPlanChange.mockReset();
	mocks.localTrialActive = false;
	mocks.selectedBillingInterval = 'monthly';
	mocks.stripeTrialPlaceholder = false;
	mocks.status = 'trialing';
	mocks.trialAvailable = false;
	mocks.trialEndsAt = new Date('2026-10-08T00:00:00.000Z');
	mocks.trialStartedAt = new Date('2026-09-24T00:00:00.000Z');
	mocks.upcomingInvoice = null;
	mocks.yearlyPlanAmount = 2_000_000;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it('offers a paid recovery Checkout when a recorded trial has no Stripe subscription', () => {
	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Subscribe in Stripe' }));

	expect(mocks.resubscribe).toHaveBeenCalledOnce();
	expect(screen.getByText('Already used')).toBeTruthy();
});

it('lets an admin choose a plan during an active local trial', () => {
	mocks.localTrialActive = true;
	mocks.trialEndsAt = new Date('2099-10-08T00:00:00.000Z');

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('nao Cloud trial')).toBeTruthy();
	expect(screen.getByText(/Your trial is already active through/)).toBeTruthy();
	expect(screen.getByText(/enter a promotion code/)).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Choose plan in Stripe' }));
	expect(mocks.openTrialCheckout).toHaveBeenCalledOnce();
});

it('keeps plan selection visible for a Stripe-backed placeholder trial', () => {
	mocks.hasStripeSubscription = true;
	mocks.stripeTrialPlaceholder = true;
	mocks.trialEndsAt = new Date('2099-10-08T00:00:00.000Z');

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('nao Cloud trial')).toBeTruthy();
	expect(screen.getByRole('button', { name: 'Choose plan in Stripe' })).toBeTruthy();
	expect(screen.queryByText('Subscription details')).toBeNull();
});

it('offers recovery when a placeholder trial has expired before its cancellation webhook arrives', () => {
	mocks.hasStripeSubscription = true;
	mocks.stripeTrialPlaceholder = true;
	mocks.trialEndsAt = new Date('2020-10-08T00:00:00.000Z');

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Your free trial has ended. Subscribe to restore access.')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Subscribe in Stripe' }));
	expect(mocks.resubscribe).toHaveBeenCalledOnce();
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

it('replaces stale billing details with a focused activation state after Checkout', () => {
	mocks.isCheckoutPolling = true;

	render(<OrganizationBillingSettings search={{ checkout: 'success', checkoutPlan: 'team' }} />);

	expect(screen.getByRole('status', { name: 'Activating your Team plan…' })).toBeTruthy();
	expect(screen.getByText('Activating your Team plan…')).toBeTruthy();
	expect(screen.queryByText('Current plan')).toBeNull();
});

it('shows a promotion code on the invoice it discounted', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoicePromotionCodes = ['EARLY50'];

	render(<OrganizationBillingSettings search={{ tab: 'invoices' }} />);

	expect(screen.getByText('Code EARLY50')).toBeTruthy();
});

it('labels a zero-value follow-up invoice as no charge', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoiceKind = 'no_charge';
	mocks.invoiceTotal = 0;

	render(<OrganizationBillingSettings search={{ tab: 'invoices' }} />);

	expect(screen.getByText('No charge')).toBeTruthy();
});

it('describes a trial invoice as a no-charge trial event', () => {
	mocks.invoiceHistoryAvailable = true;
	mocks.invoiceKind = 'trial';
	mocks.invoicePromotionCodes = ['EARLY50'];
	mocks.invoiceTotal = 0;

	render(<OrganizationBillingSettings search={{ tab: 'invoices' }} />);

	expect(screen.getByText(/\$0 charged during trial/)).toBeTruthy();
	expect(screen.queryByText(/\$0 · Paid/)).toBeNull();
	expect(screen.queryByText('Code EARLY50')).toBeNull();
});

it('uses one Stripe portal action for subscription and payment management', () => {
	mocks.hasStripeSubscription = true;
	mocks.status = 'active';
	mocks.paymentMethodManagementAvailable = true;
	mocks.portalAvailable = true;

	render(<OrganizationBillingSettings search={{ tab: 'invoices' }} />);

	fireEvent.click(screen.getByRole('button', { name: 'Manage billing in Stripe' }));

	expect(mocks.openPortal).toHaveBeenCalledOnce();
	expect(mocks.openPaymentMethodPortal).not.toHaveBeenCalled();
	expect(screen.queryByRole('button', { name: 'Manage payment method' })).toBeNull();
	expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
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
	expect(screen.getByText('Estimated first payment after trial')).toBeTruthy();
	expect(screen.getByText(/\$1,000 on/)).toBeTruthy();
	expect(screen.getByText(/This is a preview, not a paid invoice/)).toBeTruthy();
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
	expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('https://getnao.io/privacy');
	fireEvent.click(screen.getByRole('button', { name: 'Start your free trial in Stripe' }));
	expect(mocks.openTrialCheckout).toHaveBeenCalledOnce();
});

it('defaults to monthly and shows the Stripe-derived yearly discount before Checkout', () => {
	mocks.trialAvailable = true;
	mocks.trialEndsAt = null;
	mocks.trialStartedAt = null;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('button', { name: /Monthly/ }).getAttribute('aria-pressed')).toBe('true');
	expect(screen.getByRole('button', { name: /Yearly/ }).getAttribute('aria-pressed')).toBe('false');
	expect(screen.getByText(/\$20,000 per year/)).toBeTruthy();
	expect(screen.getByText('$1,666.67 per month equivalent')).toBeTruthy();
	expect(screen.getByText('16.67% off')).toBeTruthy();

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
	expect(screen.queryByText(/% off/)).toBeNull();
});

it('renders the backend-priced Free, Team, and Unlimited comparison when enabled', () => {
	mocks.freeTierEnabled = true;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('region', { name: 'Free plan' })).toBeTruthy();
	expect(screen.getByRole('region', { name: 'Team plan' }).textContent).toContain('$50');
	expect(screen.getByText('$200 total for 4 seats / month')).toBeTruthy();
	expect(screen.getByRole('region', { name: 'Unlimited plan' }).textContent).toContain('$2,000');
	expect(screen.getByText('4 using seats · 4 purchased · 0 available')).toBeTruthy();
	expect(screen.queryByText('4 purchased seats')).toBeNull();
});

it('shows yearly discounts on paid plan cards without recommending Team', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudPaidPlanSelected = false;
	mocks.selectedBillingInterval = 'yearly';

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('button', { name: 'Monthly' })).toBeTruthy();
	expect(screen.getByRole('button', { name: 'Yearly' }).getAttribute('aria-pressed')).toBe('true');
	expect(screen.getByRole('region', { name: 'Team plan' }).textContent).toContain('17% off');
	expect(screen.getByRole('region', { name: 'Team plan' }).textContent).not.toContain('Recommended');
	expect(screen.getByRole('region', { name: 'Unlimited plan' }).textContent).toContain('17% off');
});

it('shows the selected Team capacity and first payment after the free trial', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudTrialActive = true;
	mocks.cloudSeatQuantity = 6;
	mocks.upcomingInvoice = {
		amountDue: 30_000,
		currency: 'usd',
		nextPaymentAt: new Date('2099-10-01T00:00:00.000Z'),
		promotionCodes: [],
	};

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Free trial')).toBeTruthy();
	expect(screen.getByText('Team (6 seats) starts after your trial')).toBeTruthy();
	expect(screen.getByText('Estimated first payment after trial')).toBeTruthy();
	expect(screen.getByText(`$300 on ${formatBillingDate(new Date('2099-10-08T00:00:00.000Z'))}`)).toBeTruthy();
	expect(screen.getByRole('region', { name: 'Team plan' }).textContent).toContain('After trial');
	expect(screen.getByRole('button', { name: 'Starts after trial' })).toBeTruthy();

	fireEvent.click(screen.getByRole('button', { name: 'Use Free after trial' }));
	expect(screen.getByRole('dialog', { name: 'Use Free after trial' })).toBeTruthy();
});

it('keeps post-trial plan and interval selection enabled for the default Free destination', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudTrialActive = true;
	mocks.cloudPaidPlanSelected = false;
	mocks.cloudSeatUserCount = 2;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByRole('region', { name: 'Free plan' }).textContent).toContain('After trial');
	expect((screen.getByRole('button', { name: 'Monthly' }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: /Yearly/ }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: 'Choose Team' }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: 'Choose Unlimited' }) as HTMLButtonElement).disabled).toBe(false);
	expect(screen.queryByLabelText('Paid seats')).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: /Yearly/ }));
	expect(mocks.setSelectedBillingInterval).toHaveBeenCalledWith('yearly');

	fireEvent.click(screen.getByRole('button', { name: 'Choose Team' }));
	expect(screen.getByRole('dialog', { name: 'Choose Team seats' })).toBeTruthy();
	expect(screen.getByLabelText('Paid seats')).toHaveProperty('value', '');
	expect((screen.getByRole('button', { name: 'Continue to Stripe' }) as HTMLButtonElement).disabled).toBe(true);
	const seatsInput = screen.getByLabelText('Paid seats');
	fireEvent.change(seatsInput, { target: { value: '3' } });
	expect(seatsInput).toHaveProperty('value', '3');
	expect((screen.getByRole('button', { name: 'Continue to Stripe' }) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.change(seatsInput, { target: { value: '39' } });
	expect(seatsInput).toHaveProperty('value', '39');
	fireEvent.change(seatsInput, { target: { value: '99' } });
	fireEvent.blur(seatsInput);
	expect(seatsInput).toHaveProperty('value', '40');
	fireEvent.change(seatsInput, { target: { value: '1' } });
	fireEvent.blur(seatsInput);
	expect(seatsInput).toHaveProperty('value', '4');

	fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));
	expect(mocks.cloudOpenTrialCheckoutForPlan).toHaveBeenCalledWith('cloud_team_monthly_v1', 4);
});

it('allows Team capacity below trial occupancy and explains the read-only outcome', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudTrialActive = true;
	mocks.cloudPaidPlanSelected = false;
	mocks.cloudSeatUserCount = 8;

	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Team' }));
	expect(screen.getByLabelText('Paid seats')).toHaveProperty('value', '');
	fireEvent.change(screen.getByLabelText('Paid seats'), { target: { value: '4' } });

	expect(screen.getByText('$200 / month')).toBeTruthy();
	expect(screen.getByText('4 full-access users become read-only when the trial ends.')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));
	expect(mocks.cloudOpenTrialCheckoutForPlan).toHaveBeenCalledWith('cloud_team_monthly_v1', 4);
});

it('reviews an existing subscription Team change after seat selection', () => {
	mocks.freeTierEnabled = true;
	mocks.selectedBillingInterval = 'yearly';

	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Team' }));
	fireEvent.change(screen.getByLabelText('Paid seats'), { target: { value: '6' } });
	fireEvent.click(screen.getByRole('button', { name: 'Review change' }));

	expect(mocks.cloudPreviewPlanChange).toHaveBeenCalledWith('cloud_team_yearly_v1', 6);
});

it('shows the focused activation state during an immediate in-app plan change', async () => {
	mocks.freeTierEnabled = true;
	mocks.cloudPreviewPlanChange.mockResolvedValue({
		amountDue: 100,
		subtotal: 100,
		tax: 0,
		discount: 0,
		currency: 'usd',
		lines: [],
		previewToken: 'preview-token',
		expiresAt: new Date('2099-01-01T00:00:00.000Z'),
		effective: 'immediate',
		effectiveAt: new Date('2026-10-30T00:00:00.000Z'),
		readOnlyUsersAfterChange: [],
	});
	let finishChange = () => {};
	mocks.cloudConfirmPlanChange.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finishChange = resolve;
			}),
	);

	render(<OrganizationBillingSettings search={{}} />);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Unlimited' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));

	expect(await screen.findByRole('status', { name: 'Activating your Unlimited plan…' })).toBeTruthy();
	expect(mocks.cloudConfirmPlanChange).toHaveBeenCalledWith('preview-token');

	await act(async () => finishChange());
	await waitFor(() => expect(screen.queryByText('Activating your Unlimited plan…')).toBeNull());
});

it('keeps paid choices editable when Free was scheduled during an active trial', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudTrialActive = true;
	mocks.cloudCancellationScheduled = true;

	render(<OrganizationBillingSettings search={{}} />);

	expect((screen.getByRole('button', { name: 'Monthly' }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: /Yearly/ }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: 'Choose Team' }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole('button', { name: 'Choose Unlimited' }) as HTMLButtonElement).disabled).toBe(false);

	fireEvent.click(screen.getByRole('button', { name: 'Choose Unlimited' }));
	expect(mocks.cloudPreviewPlanChange).toHaveBeenCalledWith('cloud_unlimited_monthly_v1', undefined);
});

it('marks Free as the next plan and offers to keep the paid plan when a switch is scheduled', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudCancellationScheduled = true;

	render(<OrganizationBillingSettings search={{}} />);

	expect(screen.getByText('Paid plan ends')).toBeTruthy();
	expect(screen.getByRole('region', { name: 'Free plan' }).textContent).toContain('Scheduled');
	expect(screen.queryByRole('button', { name: 'Switch to Free' })).toBeNull();
	expect((screen.getByRole('button', { name: 'Choose Unlimited' }) as HTMLButtonElement).disabled).toBe(true);

	fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
	expect(mocks.cloudKeepPlan).toHaveBeenCalledOnce();
});

it('shows unlimited seat availability during a trial', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudTrialActive = true;

	render(<OrganizationBillingSettings search={{ tab: 'seats' }} />);

	expect(screen.getByText('Available seats').parentElement?.textContent).toContain('Unlimited');
	expect(screen.queryByText(/No seat limit/)).toBeNull();
	expect(screen.queryByRole('progressbar', { name: 'Seat usage' })).toBeNull();
});

it('opens a URL-selected billing tab and emits top-level tab changes', () => {
	mocks.freeTierEnabled = true;
	mocks.cloudSeatCandidates = [
		{
			userId: 'admin-1',
			name: 'Admin',
			email: 'admin@example.com',
			membershipClass: 'org_admin',
			storedOrgRole: 'admin',
			isSelected: false,
			isSeated: true,
			isReadOnly: false,
		},
		{
			userId: 'employee-1',
			name: 'Employee',
			email: 'employee@example.com',
			membershipClass: 'org_member',
			storedOrgRole: 'user',
			isSelected: false,
			isSeated: true,
			isReadOnly: false,
		},
		{
			userId: 'project-user-1',
			name: 'Project User',
			email: 'project@example.com',
			membershipClass: 'project_only',
			storedOrgRole: null,
			isSelected: false,
			isSeated: false,
			isReadOnly: true,
		},
	];
	const onTabChange = vi.fn();

	render(<OrganizationBillingSettings search={{ tab: 'seats' }} onTabChange={onTabChange} />);

	expect(screen.getByText('Available seats').parentElement?.textContent).toContain('0');
	expect(screen.getByText('4 purchased seats')).toBeTruthy();
	const usageBar = screen.getByRole('progressbar', { name: 'Seat usage' });
	expect(usageBar.getAttribute('aria-valuenow')).toBe('2');
	expect(usageBar.getAttribute('aria-valuemax')).toBe('4');
	expect(screen.getByRole('link', { name: 'Manage members' }).getAttribute('href')).toBe(
		'/settings/organization/members',
	);
	expect(screen.getByRole('row', { name: /admin@example.com/ }).textContent).toContain('Seated');
	expect(screen.getByRole('row', { name: /project@example.com/ }).textContent).toContain('Read-only');
	expect(screen.getByLabelText('Number of seats')).toHaveProperty('value', '4');
	expect(screen.getByLabelText('Number of seats')).toHaveProperty('max', '40');
	expect(screen.queryByRole('button', { name: 'Actions for Admin' })).toBeNull();
	expect(screen.queryByText('Compare plans')).toBeNull();

	fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Employee' }), { button: 0, ctrlKey: false });
	fireEvent.click(screen.getByRole('menuitem', { name: 'Make read-only' }));
	expect(mocks.cloudSaveSeatSelection).toHaveBeenCalledWith([]);

	fireEvent.click(screen.getByRole('tab', { name: 'Credits' }));
	expect(onTabChange).toHaveBeenCalledWith('credits');
});

function billingState(): BillingState {
	if (mocks.freeTierEnabled) {
		return cloudBillingState();
	}
	const plan = {
		amount: 200_000,
		currency: 'usd',
		interval: 'month',
		intervalCount: 1,
		key: 'cloud_monthly_v2',
		legacy: true,
		name: 'nao Cloud',
		perSeat: false,
		tier: 'unlimited',
		trialDays: 14,
		userLimit: null,
	} satisfies NonNullable<BillingState['plan']>;
	const yearlyPlan = {
		...plan,
		amount: mocks.yearlyPlanAmount,
		interval: 'year',
		key: 'cloud_yearly_v1',
	} as const;
	const paidPlanSelected = mocks.hasStripeSubscription && !mocks.stripeTrialPlaceholder;
	const placeholderTrialActive =
		mocks.stripeTrialPlaceholder && mocks.trialEndsAt !== null && mocks.trialEndsAt.getTime() > Date.now();
	const needsPaidPlanSelection = mocks.localTrialActive || placeholderTrialActive;
	const data = {
		availablePlans: { monthly: plan, yearly: yearlyPlan },
		billingAccessEndsAt: null,
		canManageBilling: true,
		cancellationScheduled: mocks.cancellationScheduled,
		currentPeriodEndsAt: null,
		hasDefaultPaymentMethod: false,
		hasStripeSubscription: mocks.hasStripeSubscription,
		invoiceHistoryAvailable: mocks.invoiceHistoryAvailable,
		paymentMethodManagementAvailable: mocks.paymentMethodManagementAvailable,
		needsPaidPlanSelection,
		paidPlanSelected,
		plan: paidPlanSelected ? plan : null,
		planKey: paidPlanSelected ? plan.key : null,
		portalAvailable: mocks.portalAvailable,
		resubscribeAvailable:
			(!mocks.hasStripeSubscription && !mocks.localTrialActive) ||
			(mocks.stripeTrialPlaceholder && mocks.trialEndsAt !== null && mocks.trialEndsAt.getTime() <= Date.now()) ||
			mocks.status === 'canceled' ||
			mocks.status === 'incomplete_expired',
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
			data.paidPlanSelected &&
			!data.cancellationScheduled &&
			(data.status === 'trialing' || data.status === 'active' || data.status === 'past_due'),
		checkoutFeedback: null,
		hasStripeSubscription: mocks.hasStripeSubscription,
		needsPaidPlanSelection,
		paidPlanSelected,
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
		isHistoricalSubscription: isTerminalBillingStatus(mocks.status),
		isPaymentMethodPortalPending: false,
		isPortalPending: false,
		isResubscribePending: false,
		isResumePending: false,
		isTrialCheckoutPending: false,
		managementError: null,
		openPaymentMethodPortal: mocks.openPaymentMethodPortal,
		openPortal: mocks.openPortal,
		openTrialCheckout: mocks.openTrialCheckout,
		plan,
		portalFeedback: null,
		resubscribe: mocks.resubscribe,
		resubscribeForPlan: vi.fn(),
		selectedBillingInterval: mocks.selectedBillingInterval,
		setSelectedBillingInterval: mocks.setSelectedBillingInterval,
		selectedBillingTier: 'unlimited',
		setSelectedBillingTier: vi.fn(),
		selectedPlanKey: 'cloud_unlimited_monthly_v1',
		freeTierEnabled: false,
		previewSeatChange: vi.fn(),
		confirmSeatChange: vi.fn(),
		previewPlanChange: vi.fn(),
		confirmPlanChange: vi.fn(),
		saveSeatSelection: vi.fn(),
		switchToFree: vi.fn(),
		keepPlan: vi.fn(),
		cancelPendingPlanChange: vi.fn(),
		isBillingCommandPending: false,
		isPlanSelectionPending: false,
		resume: vi.fn(),
		retryCheckoutConfirmation: vi.fn(),
		status: mocks.status,
		statusView: getBillingStatusView(mocks.status, false, false, paidPlanSelected),
		syncBilling: vi.fn(),
		trialCheckoutError: null,
		openTrialCheckoutForPlan: vi.fn(),
	} satisfies BillingState;
}

function cloudBillingState(): BillingState {
	const cloudTier = mocks.cloudTrialActive ? 'trial' : 'team';
	const cloudStatus = mocks.cloudTrialActive ? 'trialing' : 'active';
	const cloudTrialEndsAt = mocks.cloudTrialActive ? new Date('2099-10-08T00:00:00.000Z') : null;
	const currentPlan = mocks.cloudPaidPlanSelected
		? {
				planKey: 'cloud_team_monthly_v1' as const,
				tier: 'team' as const,
				interval: 'monthly' as const,
				legacy: false,
				currency: 'usd',
				seatQuantity: mocks.cloudSeatQuantity,
			}
		: null;
	const plans = [
		{
			planKey: 'cloud_team_monthly_v1',
			tier: 'team',
			interval: 'monthly',
			currency: 'usd',
			unitAmount: 5_000,
			perSeat: true,
		},
		{
			planKey: 'cloud_team_yearly_v1',
			tier: 'team',
			interval: 'yearly',
			currency: 'usd',
			unitAmount: 50_000,
			perSeat: true,
		},
		{
			planKey: 'cloud_unlimited_monthly_v1',
			tier: 'unlimited',
			interval: 'monthly',
			currency: 'usd',
			unitAmount: 200_000,
			perSeat: false,
		},
		{
			planKey: 'cloud_unlimited_yearly_v1',
			tier: 'unlimited',
			interval: 'yearly',
			currency: 'usd',
			unitAmount: 2_000_000,
			perSeat: false,
		},
	] as const;
	return {
		...billingStateDefaults(),
		freeTierEnabled: true,
		canLoadUpcomingInvoice:
			currentPlan !== null &&
			!mocks.cloudCancellationScheduled &&
			(cloudStatus === 'trialing' || cloudStatus === 'active'),
		status: cloudStatus,
		billing: {
			data: {
				access: {
					organizationId: 'org-1',
					hasAccess: true,
					bypassBilling: false,
					canManageBilling: true,
					tier: cloudTier,
					status: cloudStatus,
					billingPlan: currentPlan?.planKey ?? null,
					trialEndsAt: cloudTrialEndsAt,
					accessEndsAt: null,
					seatUserCount: mocks.cloudSeatUserCount,
					seatQuantity: currentPlan?.seatQuantity ?? null,
					seatLimit: mocks.cloudTrialActive ? null : 4,
					availableSeats: mocks.cloudTrialActive ? null : 0,
					overCapacity: false,
					isReadOnly: false,
					trialAvailable: false,
					requiresBillingAction: false,
					freeTierEnabled: true,
				},
				availablePlans: plans,
				seatCandidates: mocks.cloudSeatCandidates,
				current: currentPlan,
				pending: null,
				recommendation: 'team',
				cancellationScheduled: mocks.cloudCancellationScheduled,
				scheduleConflict: false,
				currentPeriodEndsAt: new Date('2026-11-01T00:00:00.000Z'),
				invoiceHistoryAvailable: false,
				canManageBilling: true,
				needsPaidPlanSelection: mocks.cloudTrialActive && !mocks.cloudPaidPlanSelected,
				paidPlanSelected: mocks.cloudPaidPlanSelected,
				hasStripeSubscription: true,
				status: cloudStatus,
				trialEndsAt: cloudTrialEndsAt,
				hasDefaultPaymentMethod: true,
				portalAvailable: false,
				paymentMethodManagementAvailable: false,
			},
			isError: false,
			isLoading: false,
		},
	} as unknown as BillingState;
}

function billingStateDefaults(): Partial<BillingState> {
	return {
		invoices: { data: [], isError: false, isLoading: false } as BillingState['invoices'],
		upcomingInvoice: {
			data: mocks.upcomingInvoice,
			isError: false,
			isLoading: false,
		} as BillingState['upcomingInvoice'],
		selectedBillingInterval: mocks.selectedBillingInterval,
		setSelectedBillingInterval: mocks.setSelectedBillingInterval,
		selectedBillingTier: 'team',
		setSelectedBillingTier: vi.fn(),
		isBillingCommandPending: false,
		isPlanSelectionPending: false,
		previewPlanChange: mocks.cloudPreviewPlanChange,
		confirmPlanChange: mocks.cloudConfirmPlanChange,
		previewSeatChange: vi.fn(),
		confirmSeatChange: vi.fn(),
		saveSeatSelection: mocks.cloudSaveSeatSelection,
		switchToFree: vi.fn(),
		keepPlan: mocks.cloudKeepPlan,
		cancelPendingPlanChange: vi.fn(),
		openTrialCheckoutForPlan: mocks.cloudOpenTrialCheckoutForPlan,
		resubscribeForPlan: vi.fn(),
		openPaymentMethodPortal: vi.fn(),
	};
}
