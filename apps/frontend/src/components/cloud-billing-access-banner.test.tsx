// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CloudBillingAccessBanner } from './cloud-billing-access-banner';

type RefetchInterval = (query: { state: { data: Record<string, unknown> | undefined } }) => number | false;

const DAY_MS = 24 * 60 * 60 * 1000;

const restrictedTrialAccess = {
	canManageBilling: true,
	hasAccess: false,
	bypassBilling: false,
	organizationId: 'project-organization',
	requiresBillingAction: true,
	status: 'trialing',
	trialAvailable: false,
	trialEndsAt: null,
};

const mocks = vi.hoisted(() => ({
	access: {} as Record<string, unknown>,
	cloudBillingEnabled: true,
	invalidateQueries: vi.fn(async () => undefined),
	navigate: vi.fn(async () => undefined),
	pathname: '/',
	refetchInterval: undefined as RefetchInterval | undefined,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean; refetchInterval?: RefetchInterval }) => {
		if (options.queryKey[0] === 'config') {
			return { data: { cloudBillingEnabled: mocks.cloudBillingEnabled } };
		}
		mocks.refetchInterval = options.refetchInterval;
		if (options.enabled === false) {
			return { data: undefined };
		}
		return { data: mocks.access };
	},
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
	useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
		select({ location: { pathname: mocks.pathname } }),
}));

vi.mock('@/main', () => ({
	trpc: {
		billing: { getAccess: { queryOptions: () => ({ queryKey: ['access'] }) } },
		system: { getPublicConfig: { queryOptions: () => ({ queryKey: ['config'] }) } },
	},
}));

beforeEach(() => {
	mocks.access = restrictedTrialAccess;
	mocks.cloudBillingEnabled = true;
	mocks.pathname = '/';
	mocks.refetchInterval = undefined;
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('stays hidden when cloud billing is disabled', () => {
	mocks.cloudBillingEnabled = false;

	render(<CloudBillingAccessBanner />);

	expect(screen.queryByText('A subscription is needed to keep using nao Cloud.')).toBeNull();
});

it('stays hidden on the plan and billing page', () => {
	mocks.pathname = '/settings/organization/billing';

	render(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();
});

it('hides the active trial banner throughout settings without hiding access notices', () => {
	mocks.pathname = '/settings/account';
	const view = render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('A subscription is needed');

	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt: new Date(Date.now() + 14 * DAY_MS),
	};

	view.rerender(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();
});

it('explains the subscription requirement without presenting it as an alert', () => {
	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('A subscription is needed to keep using nao Cloud.');
	expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the subscription notice for admins of an organization that bypasses billing', () => {
	mocks.access = { ...restrictedTrialAccess, bypassBilling: true };

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('A subscription is needed to keep using nao Cloud.');
});

it('hides the notice from members of an organization that bypasses billing', () => {
	mocks.access = { ...restrictedTrialAccess, bypassBilling: true, canManageBilling: false };

	render(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();
});

it('warns about a failed payment while access is kept', () => {
	mocks.access = { ...restrictedTrialAccess, hasAccess: true, status: 'past_due' };

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('A payment failed.');
	expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a persistent read-only notice without calling the organization restricted', () => {
	mocks.access = {
		...restrictedTrialAccess,
		freeTierEnabled: true,
		hasAccess: true,
		isReadOnly: true,
		overCapacity: true,
		seatUserCount: 5,
		seatLimit: 3,
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain(
		'You have viewer access until an organization admin adds a seat.',
	);
	expect(screen.queryByText(/subscription is needed/i)).toBeNull();
});

it('explains the Free destination when a small trial ends', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		freeTierEnabled: true,
		hasAccess: true,
		tier: 'trial',
		seatUserCount: 3,
		seatQuantity: null,
		trialEndsAt: new Date(now.getTime() + 2 * DAY_MS),
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('You’ll move to Free');
});

it('shows admins that their trial has started and rounds up the remaining days', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt: new Date(now.getTime() + 13 * DAY_MS + 1),
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain(
		'Your free trial has started. 14 days left. Only admins can see this banner.',
	);
});

it('lets admins dismiss the trial-start banner', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	const trialEndsAt = new Date(now.getTime() + 14 * DAY_MS);
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt,
	};

	render(<CloudBillingAccessBanner />);
	fireEvent.click(screen.getByRole('button', { name: 'Dismiss trial banner' }));

	expect(screen.queryByRole('status')).toBeNull();
	expect(localStorage.getItem('nao-dismissed-trial-banner')).toBe(
		JSON.stringify([`project-organization:${trialEndsAt.toISOString()}`]),
	);
});

it('keeps trial-start dismissals for multiple organizations', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	const trialEndsAt = new Date(now.getTime() + 14 * DAY_MS);
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt,
	};

	const view = render(<CloudBillingAccessBanner />);
	fireEvent.click(screen.getByRole('button', { name: 'Dismiss trial banner' }));

	mocks.access = { ...mocks.access, organizationId: 'other-organization' };
	view.rerender(<CloudBillingAccessBanner />);
	fireEvent.click(screen.getByRole('button', { name: 'Dismiss trial banner' }));

	mocks.access = { ...mocks.access, organizationId: 'project-organization' };
	view.rerender(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();
	expect(localStorage.getItem('nao-dismissed-trial-banner')).toBe(
		JSON.stringify([
			`project-organization:${trialEndsAt.toISOString()}`,
			`other-organization:${trialEndsAt.toISOString()}`,
		]),
	);
});

it('shows the final three-day warning even when the trial-start banner was dismissed', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	const trialEndsAt = new Date(now.getTime() + 2 * DAY_MS);
	vi.useFakeTimers();
	vi.setSystemTime(now);
	localStorage.setItem(
		'nao-dismissed-trial-banner',
		JSON.stringify(`project-organization:${trialEndsAt.toISOString()}`),
	);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt,
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('Your free trial ends soon. 2 days left.');
	expect(screen.queryByRole('button', { name: 'Dismiss trial banner' })).toBeNull();
});

it('hides the trial-start notice from non-admins but shows the final three-day warning', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		canManageBilling: false,
		hasAccess: true,
		trialEndsAt: new Date(now.getTime() + 14 * DAY_MS),
	};

	const view = render(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();

	mocks.access = { ...mocks.access, trialEndsAt: new Date(now.getTime() + 2 * DAY_MS) };
	view.rerender(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain(
		'Your free trial ends soon. 2 days left. An organization admin must manage billing to keep access.',
	);
	expect(screen.getByText('Ask an organization admin to manage billing.')).toBeTruthy();
});

it('offers an available trial to non-managers and lets them dismiss it', () => {
	mocks.access = { ...restrictedTrialAccess, canManageBilling: false, trialAvailable: true };

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('An organization admin can start the free trial.');
	expect(screen.getByText('Ask an organization admin to manage billing.')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: 'Dismiss trial banner' }));

	expect(screen.queryByRole('status')).toBeNull();
	expect(localStorage.getItem('nao-dismissed-trial-banner')).toBe(JSON.stringify(['project-organization:available']));
});

it('stops polling after active billing access is confirmed', () => {
	mocks.access = { ...restrictedTrialAccess, hasAccess: true, status: 'active' };

	render(<CloudBillingAccessBanner />);

	expect(mocks.refetchInterval?.({ state: { data: mocks.access } })).toBe(false);
	expect(mocks.refetchInterval?.({ state: { data: restrictedTrialAccess } })).toBe(60_000);
});

it('selects the project organization before opening billing management', async () => {
	render(<CloudBillingAccessBanner />);

	fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));

	await waitFor(() => {
		expect(localStorage.getItem('nao.active-organization-id')).toBe('"project-organization"');
		expect(mocks.invalidateQueries).toHaveBeenCalledOnce();
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/organization/billing',
			search: { checkout: undefined, portal: undefined },
		});
	});
});
