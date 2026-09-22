// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SsoSettingsSection } from './sso-settings-section';

const mocks = vi.hoisted(() => ({
	useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: { sso: true } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		authConfig: {
			oidc: { getConfig: { queryOptions: () => ({ queryKey: ['oidc'] }) } },
			microsoft: { isSetup: { queryOptions: () => ({ queryKey: ['microsoft'] }) } },
			sso: { getStatus: { queryOptions: () => ({ queryKey: ['sso'] }) } },
		},
	},
}));

afterEach(cleanup);

describe('SsoSettingsSection', () => {
	it('shows organization role management as active for Entra-only configuration', () => {
		mocks.useQuery.mockImplementation((options: { queryKey: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options.queryKey[0] === 'oidc'
					? null
					: options.queryKey[0] === 'microsoft'
						? true
						: { organizationRolesManagedByIdp: true, providerName: 'Microsoft Entra' },
		}));

		render(<SsoSettingsSection />);

		expect(screen.getByText('Organization roles managed by your identity provider')).toBeTruthy();
		expect(screen.getAllByText('Active')).toHaveLength(2);
	});
});
