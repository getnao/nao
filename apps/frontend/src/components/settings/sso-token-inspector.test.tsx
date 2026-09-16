// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SsoTokenInspector } from './sso-token-inspector';

vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('@/main', () => ({
	trpc: {
		authConfig: {
			oidc: {
				getConfig: { queryOptions: () => ({ queryKey: ['oidc-config'] }) },
				inspectToken: { queryOptions: () => ({ queryKey: ['inspect-token'] }) },
			},
		},
		project: {
			listAllUsersWithRoles: { queryOptions: () => ({ queryKey: ['project-members'] }) },
		},
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[] }) => {
		if (options.queryKey[0] === 'oidc-config') {
			return { data: { providerName: 'Okta' }, isLoading: false, isError: false };
		}
		if (options.queryKey[0] === 'project-members') {
			return {
				data: [{ id: 'user-1', email: 'ada@example.com' }],
				isLoading: false,
				isError: false,
			};
		}
		return {
			data: {
				claimName: 'groups',
				groups: ['nao-admins'],
				matchedGroups: ['nao-admins'],
				resolvedOrganizationRole: 'admin',
				problem: null,
				claims: { groups: ['nao-admins'] },
				issuedAt: null,
			},
			isLoading: false,
			isError: false,
		};
	},
}));

afterEach(cleanup);

describe('SsoTokenInspector', () => {
	it('labels the mapped result as an organization role', () => {
		render(<SsoTokenInspector />);

		expect(screen.getByText(/resolved to an organization role/)).toBeTruthy();
		expect(screen.getByText('Organization role')).toBeTruthy();
		expect(screen.getByText('Admin')).toBeTruthy();
		expect(screen.queryByText('Resolved role')).toBeNull();
	});
});
