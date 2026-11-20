// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import { OrgApiKeys } from '@/components/settings/org-api-keys';

const mocks = vi.hoisted(() => ({ getOrganization: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		organization: {
			get: { queryOptions: () => ({ queryKey: ['organization'], queryFn: mocks.getOrganization }) },
		},
		apiKey: {
			list: { queryOptions: () => ({ queryKey: ['api-keys'], queryFn: async () => [] }) },
			create: {
				mutationOptions: (options: object) => ({
					mutationFn: async () => ({ id: 'key-id', plaintext: 'nao_key_of_first_organization' }),
					...options,
				}),
			},
			revoke: { mutationOptions: (options: object) => options },
		},
	},
}));

afterEach(cleanup);

it('hides the key it just generated once the page follows a switch to another organization', async () => {
	mocks.getOrganization.mockResolvedValue({ id: 'first-organization' });
	const queryClient = createTestQueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<OrgApiKeys isAdmin />
		</QueryClientProvider>,
	);
	await waitFor(() => expect(queryClient.getQueryData(['organization'])).toEqual({ id: 'first-organization' }));

	fireEvent.click(screen.getByRole('button', { name: /generate/i }));
	expect(await screen.findByText(/nao_key_of_first_organization/)).toBeTruthy();

	mocks.getOrganization.mockResolvedValue({ id: 'second-organization' });
	await queryClient.invalidateQueries();

	await waitFor(() => expect(screen.queryByText(/nao_key_of_first_organization/)).toBeNull());
});
