// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CloudBillingAccessBanner } from './cloud-billing-access-banner';

const restrictedTrialAccess = {
	canManageBilling: true,
	hasAccess: false,
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
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
		if (options.queryKey[0] === 'config') {
			return { data: { cloudBillingEnabled: mocks.cloudBillingEnabled } };
		}
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
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
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

it('warns about a failed payment while access is kept', () => {
	mocks.access = { ...restrictedTrialAccess, hasAccess: true, status: 'past_due' };

	render(<CloudBillingAccessBanner />);

	expect(screen.getByRole('status').textContent).toContain('A payment failed.');
	expect(screen.queryByRole('alert')).toBeNull();
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
