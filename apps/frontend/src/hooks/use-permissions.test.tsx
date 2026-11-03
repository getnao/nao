// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { usePermissions } from './use-permissions';
import type { ReactNode } from 'react';

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: {
				queryOptions: () => ({
					queryKey: ['project'],
					queryFn: async () => ({ userRole: 'user' }),
				}),
			},
		},
		organization: {
			get: {
				queryOptions: () => ({
					queryKey: ['organization'],
					queryFn: async () => ({ role: 'admin' }),
				}),
			},
		},
		billing: {
			getAccess: {
				queryOptions: () => ({
					queryKey: ['billing-access'],
					queryFn: async () => ({ freeTierEnabled: true, isReadOnly: true }),
				}),
			},
		},
		system: {
			getPublicConfig: {
				queryOptions: () => ({
					queryKey: ['config'],
					queryFn: async () => ({ cloudBillingEnabled: true }),
				}),
			},
		},
	},
}));

it('retains stored roles while applying read-only permissions', async () => {
	const { result } = renderHook(usePermissions, { wrapper });

	await waitFor(() => expect(result.current.role).toBe('user'));
	await waitFor(() => expect(result.current.isSeatReadOnly).toBe(true));

	expect(result.current.isUser).toBe(true);
	expect(result.current.isOrgAdmin).toBe(true);
	expect(result.current.canSendMessages).toBe(false);
	expect(result.current.canShare).toBe(false);
	expect(result.current.canStartNewChat).toBe(false);
});

function wrapper({ children }: { children: ReactNode }) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
