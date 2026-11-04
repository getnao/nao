// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { OrgApiKeys } from './org-api-keys';

type ApiKey = {
	id: string;
	name: string;
	keyPrefix: string;
	scope: string;
	createdAt: number;
	lastUsedAt: number | null;
};
type CreateVariables = { name: string; scope: string };
type CreateResult = { plaintext: string; scope: string };

const mocks = vi.hoisted(() => ({
	apiKeys: [] as ApiKey[],
	createVariables: undefined as CreateVariables | undefined,
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
	useQuery: () => ({ data: mocks.apiKeys, isLoading: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useMutation: (options: { onSuccess?: (result: CreateResult) => Promise<void> }) => ({
		mutate: vi.fn(),
		mutateAsync: async (variables: CreateVariables) => {
			mocks.createVariables = variables;
			await options.onSuccess?.({ plaintext: 'nao_plaintext_key', scope: variables.scope });
		},
		isPending: false,
	}),
}));

const DEPLOY_KEY: ApiKey = {
	id: 'deploy-key',
	name: 'CI deploy',
	keyPrefix: 'nao_dep',
	scope: 'deploy',
	createdAt: 0,
	lastUsedAt: null,
};

const USER_MANAGEMENT_KEY: ApiKey = {
	id: 'user-management-key',
	name: 'HR admin',
	keyPrefix: 'nao_usr',
	scope: 'user_management',
	createdAt: 0,
	lastUsedAt: null,
};

const cardOf = (title: string) => within(screen.getByText(title).closest('div.flex.flex-col') as HTMLElement);

afterEach(() => {
	mocks.apiKeys = [];
	mocks.createVariables = undefined;
	cleanup();
});

it('lists only its own scope keys in each card', () => {
	mocks.apiKeys = [DEPLOY_KEY, USER_MANAGEMENT_KEY];

	render(
		<>
			<OrgApiKeys isAdmin scope='deploy' />
			<OrgApiKeys isAdmin scope='user_management' />
		</>,
	);

	expect(cardOf('Deploy keys').getByText('CI deploy')).toBeTruthy();
	expect(cardOf('Deploy keys').queryByText('HR admin')).toBeNull();
	expect(cardOf('User management API keys').getByText('HR admin')).toBeTruthy();
	expect(cardOf('User management API keys').queryByText('CI deploy')).toBeNull();
});

it('creates a user management key from the user management card', async () => {
	render(<OrgApiKeys isAdmin scope='user_management' deployUrl='https://nao.example.com/deploy' />);

	fireEvent.click(screen.getByRole('button', { name: 'Generate user management key' }));

	await waitFor(() =>
		expect(mocks.createVariables).toEqual({ name: 'User management key', scope: 'user_management' }),
	);
	await screen.findByText('nao_plaintext_key');
	expect(cardOf('User management API keys').queryByText('Deploy command')).toBeNull();
});

it('creates a deploy key from the deploy card and offers the deploy command', async () => {
	render(<OrgApiKeys isAdmin scope='deploy' deployUrl='https://nao.example.com/deploy' />);

	fireEvent.click(screen.getByRole('button', { name: 'Generate deploy key' }));

	await waitFor(() => expect(mocks.createVariables).toEqual({ name: 'Deploy key', scope: 'deploy' }));
	await screen.findByText(/nao deploy https:\/\/nao\.example\.com\/deploy --api-key nao_plaintext_key/);
});

it('never shows the deploy command on the user management card', () => {
	render(
		<>
			<OrgApiKeys isAdmin scope='deploy' deployUrl='https://nao.example.com/deploy' />
			<OrgApiKeys isAdmin scope='user_management' deployUrl='https://nao.example.com/deploy' />
		</>,
	);

	expect(cardOf('Deploy keys').getByText('Deploy command')).toBeTruthy();
	expect(cardOf('User management API keys').queryByText('Deploy command')).toBeNull();
	expect(screen.getAllByText(/nao deploy https:\/\/nao\.example\.com\/deploy/)).toHaveLength(1);
});

it('names each card for its own scope so the two cards are distinguishable', () => {
	render(
		<>
			<OrgApiKeys isAdmin scope='deploy' />
			<OrgApiKeys isAdmin scope='user_management' />
		</>,
	);

	const deployCard = cardOf('Deploy keys');
	expect(deployCard.getByText('Existing deploy keys')).toBeTruthy();
	expect(deployCard.getByRole('textbox', { name: 'API key name (deploy)' })).toBeTruthy();
	expect(deployCard.getByRole('button', { name: 'Generate deploy key' })).toBeTruthy();

	const userManagementCard = cardOf('User management API keys');
	expect(userManagementCard.getByText('Existing user management keys')).toBeTruthy();
	expect(userManagementCard.getByRole('textbox', { name: 'API key name (user management)' })).toBeTruthy();
	expect(userManagementCard.getByRole('button', { name: 'Generate user management key' })).toBeTruthy();
});

it('hides the deploy command on the deploy card when the page passes no deploy url', async () => {
	render(<OrgApiKeys isAdmin scope='deploy' />);

	fireEvent.click(screen.getByRole('button', { name: 'Generate deploy key' }));

	await waitFor(() => expect(mocks.createVariables).toEqual({ name: 'Deploy key', scope: 'deploy' }));
	expect(screen.queryByText('Deploy command')).toBeNull();
});
