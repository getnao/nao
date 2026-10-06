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

it('rounds up the trial countdown within the three-day warning window', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt: new Date(now.getTime() + DAY_MS + 1),
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('2 days left in your free trial.');
});

it('stays hidden before the three-day trial warning window', () => {
	const now = new Date('2026-10-05T12:00:00.000Z');
	vi.useFakeTimers();
	vi.setSystemTime(now);
	mocks.access = {
		...restrictedTrialAccess,
		hasAccess: true,
		trialEndsAt: new Date(now.getTime() + 3 * DAY_MS + 1),
	};

	render(<CloudBillingAccessBanner />);

	expect(screen.queryByRole('status')).toBeNull();
});

it('offers an available trial to non-managers without a billing action', () => {
	mocks.access = { ...restrictedTrialAccess, canManageBilling: false, trialAvailable: true };

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain(
		'An organization admin can activate 14 days of nao Cloud.',
	);
	expect(screen.getByText('Ask an organization admin to manage billing.')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
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
