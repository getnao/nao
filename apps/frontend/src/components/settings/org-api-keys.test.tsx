// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { OrgApiKeys } from './org-api-keys';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	mutations: [] as unknown[],
}));

vi.mock('@/main', () => ({
	trpc: {
		apiKey: {
			list: { queryOptions: () => ({ queryKey: ['api-key-list'] }) },
			create: { mutationOptions: (options: unknown) => options },
			revoke: { mutationOptions: (options: unknown) => options },
		},
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: [], isLoading: false }),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
	useMutation: (options: unknown) => {
		mocks.mutations.push(options);
		return { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
	},
}));

type CreatedKey = { plaintext: string; scope: string };
const createKey = (key: CreatedKey) =>
	(mocks.mutations[0] as { onSuccess: (result: CreatedKey) => Promise<void> }).onSuccess(key);

afterEach(() => {
	mocks.mutations.length = 0;
	cleanup();
});

it('offers the deploy command and the deploy name only for a deploy-scoped key', async () => {
	render(<OrgApiKeys isAdmin deployUrl='https://nao.example.com/deploy' />);

	expect(screen.getByText(/nao deploy https:\/\/nao\.example\.com\/deploy/)).toBeTruthy();

	// A user-management key cannot deploy: the command has to go, and the field stop calling itself a
	// deploy key.
	await act(async () => {
		await createKey({ plaintext: 'nao_um_key', scope: 'user_management' });
	});

	expect(screen.queryByText(/nao deploy /)).toBeNull();
	expect(screen.getByText('nao_um_key')).toBeTruthy();
	expect((screen.getByLabelText('API key name') as HTMLInputElement).value).toBe('User management key');
});
