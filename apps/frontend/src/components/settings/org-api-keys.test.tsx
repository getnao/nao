// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { OrgApiKeys } from './org-api-keys';
import type { ReactNode } from 'react';

type CreateVariables = { name: string; scope: string };
type CreateResult = { plaintext: string; scope: string };

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	createVariables: undefined as CreateVariables | undefined,
	createOnSuccess: undefined as ((result: CreateResult) => Promise<void>) | undefined,
}));

vi.mock('@/main', () => ({
	trpc: {
		apiKey: {
			list: { queryOptions: () => ({ queryKey: ['api-key-list'] }) },
			create: {
				mutationOptions: (options: { onSuccess: (result: CreateResult) => Promise<void> }) => {
					mocks.createOnSuccess = options.onSuccess;
					return options;
				},
			},
			revoke: { mutationOptions: (options: unknown) => options },
		},
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: [], isLoading: false }),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
	useMutation: (options: { onSuccess?: (result: CreateResult) => Promise<void> }) => ({
		mutate: vi.fn(),
		// Run the success handler like react-query does, so the test covers the real submit path.
		mutateAsync: async (variables: CreateVariables) => {
			mocks.createVariables = variables;
			await options.onSuccess?.({ plaintext: 'nao_um_key', scope: variables.scope });
		},
		isPending: false,
	}),
}));

// Radix's select needs a real pointer stack in jsdom; a native select keeps the interaction real
// without reaching into the component's own handlers.
vi.mock('@/components/ui/select', () => ({
	Select: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (value: string) => void;
		children: ReactNode;
	}) => (
		<select aria-label='API key scope' value={value} onChange={(event) => onValueChange(event.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
		<option value={value}>{children}</option>
	),
}));

afterEach(() => {
	mocks.createVariables = undefined;
	mocks.createOnSuccess = undefined;
	cleanup();
});

it('sends the selected scope and drops the deploy command for a user-management key', async () => {
	render(<OrgApiKeys isAdmin deployUrl='https://nao.example.com/deploy' />);

	// A deploy key is the default, so the command is offered with a placeholder.
	expect(screen.getByText(/nao deploy https:\/\/nao\.example\.com\/deploy/)).toBeTruthy();

	fireEvent.change(screen.getByLabelText('API key scope'), { target: { value: 'user_management' } });
	fireEvent.click(screen.getByRole('button', { name: 'Generate API key' }));

	await waitFor(() =>
		expect(mocks.createVariables).toEqual({ name: 'User management key', scope: 'user_management' }),
	);
	await screen.findByText('nao_um_key');

	// A user-management key cannot deploy: the command has to go, and the field stops calling itself
	// a deploy key.
	expect(screen.queryByText(/nao deploy https:\/\/nao\.example\.com\/deploy/)).toBeNull();
	expect((screen.getByLabelText('API key name') as HTMLInputElement).value).toBe('User management key');
});
