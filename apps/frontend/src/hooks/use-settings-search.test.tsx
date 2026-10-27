// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsSearch } from './use-settings-search';

const mocks = vi.hoisted(() => ({
	config: {
		betaSubagentsEnabled: false,
		cloudBillingEnabled: false,
	},
	isCloud: false,
	permissions: {
		canViewUsage: false,
		isAdmin: false,
		isContextAdmin: false,
		isOrgAdmin: false,
		isViewer: true,
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: mocks.config }),
}));

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: {} }),
}));

vi.mock('@/hooks/use-can-see-advanced-settings', () => ({
	useCanSeeAdvancedSettings: () => true,
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => mocks.isCloud,
}));

vi.mock('@/hooks/use-permissions', () => ({
	usePermissions: () => mocks.permissions,
}));

vi.mock('@/main', () => ({
	trpc: {
		system: {
			getPublicConfig: {
				queryOptions: () => ({}),
			},
		},
	},
}));

describe('useSettingsSearch', () => {
	beforeEach(() => {
		mocks.config.cloudBillingEnabled = false;
		mocks.isCloud = false;
		Object.assign(mocks.permissions, {
			canViewUsage: false,
			isAdmin: false,
			isContextAdmin: false,
			isOrgAdmin: false,
			isViewer: true,
		});
	});

	afterEach(cleanup);

	it.each(['Messages', 'Tokens', 'Cost'])('returns %s to every role with usage access', (title) => {
		const { result, rerender } = renderHook(() => useSettingsSearch(title));

		expect(result.current.some((entry) => entry.title === title)).toBe(false);

		Object.assign(mocks.permissions, { canViewUsage: true, isViewer: false });
		rerender();

		expect(result.current.some((entry) => entry.title === title)).toBe(true);

		mocks.permissions.isContextAdmin = true;
		rerender();

		expect(result.current.some((entry) => entry.title === title)).toBe(true);

		mocks.permissions.isAdmin = true;
		rerender();

		expect(result.current.some((entry) => entry.title === title)).toBe(true);
	});

	it.each(['Balance', 'nao AI usage'])('only returns %s when cloud billing is enabled', (searchTitle) => {
		mocks.isCloud = true;
		Object.assign(mocks.permissions, { isOrgAdmin: true, isViewer: false });
		const { result, rerender } = renderHook(() => useSettingsSearch(searchTitle));

		expect(result.current.some((entry) => entry.title === searchTitle)).toBe(false);

		mocks.config.cloudBillingEnabled = true;
		rerender();

		const billingEntry = result.current.find((entry) => entry.title === searchTitle);
		expect(billingEntry?.page).toBe('/settings/organization/billing');
		if (searchTitle === 'nao AI usage') {
			expect(billingEntry?.search).toEqual({ creditsTab: 'usage' });
		}
	});
});
