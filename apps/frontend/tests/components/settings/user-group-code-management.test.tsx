// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { UserGroupCodeManagement } from '@/components/settings/user-group-code-management';

interface MutationOptions {
	mutationKey?: string[];
	onSuccess?: () => void | Promise<void>;
	onSettled?: () => void | Promise<void>;
}

const mocks = vi.hoisted(() => ({
	disable: vi.fn(),
	invalidateQueries: vi.fn(),
	managementStatus: vi.fn(),
	previewRefetch: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
	useQuery: (options: { queryKey?: string[] }) => {
		if (options.queryKey?.[0] === 'management-status') {
			return { data: mocks.managementStatus() };
		}
		return {
			data: undefined,
			error: null,
			isFetching: false,
			isError: false,
			refetch: mocks.previewRefetch,
		};
	},
	useMutation: (options: MutationOptions) => ({
		isPending: false,
		isError: false,
		mutate: () => {
			void (async () => {
				if (options.mutationKey?.[0] === 'disable') {
					await mocks.disable();
				}
				await options.onSuccess?.();
				await options.onSettled?.();
			})();
		},
	}),
}));

vi.mock('@/main', () => ({
	trpcClient: {
		userGroup: {
			exportConfig: { query: vi.fn() },
		},
	},
	trpc: {
		userGroup: {
			managementStatus: {
				queryOptions: () => ({ queryKey: ['management-status'] }),
				queryKey: () => ['management-status'],
			},
			previewCodeManagement: {
				queryOptions: () => ({ queryKey: ['preview-code-management'] }),
			},
			enableCodeManagement: {
				mutationOptions: (options: MutationOptions) => ({ ...options, mutationKey: ['enable'] }),
			},
			disableCodeManagement: {
				mutationOptions: (options: MutationOptions) => ({ ...options, mutationKey: ['disable'] }),
			},
			overview: {
				queryKey: () => ['overview'],
			},
		},
	},
}));

beforeEach(() => {
	mocks.disable.mockReset().mockResolvedValue(undefined);
	mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
	mocks.previewRefetch.mockReset();
	mocks.managementStatus.mockReset().mockReturnValue({
		mode: 'code',
		pendingEmails: [],
		lastSuccess: null,
		latestFailure: null,
	});
});

afterEach(cleanup);

it('closes the dialog after returning user groups to UI management', async () => {
	render(<UserGroupCodeManagement />);

	fireEvent.click(screen.getByRole('button', { name: 'Return to UI management' }));
	fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Return to UI management' }));

	await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	expect(mocks.disable).toHaveBeenCalledOnce();
	expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
});

it('previews each code-management change before enabling it', async () => {
	mocks.managementStatus.mockReturnValue({
		mode: 'ui',
		pendingEmails: [],
		lastSuccess: null,
		latestFailure: null,
	});
	mocks.previewRefetch.mockResolvedValue({
		data: {
			hash: 'config-hash',
			mode: 'ui',
			allUsersChanged: true,
			groups: [
				{ action: 'adopted', key: 'analysts', name: 'Analysts', groupId: 'group-1' },
				{ action: 'created', key: 'finance', name: 'Finance', groupId: null },
			],
			pendingEmails: ['pending@example.com'],
			shareRevocations: { chats: 2, stories: 1 },
			accessChanges: ['analysts'],
			budgetChanges: ['finance'],
			summary: { created: 1, adopted: 1, updated: 0, archived: 0, reactivated: 0, unchanged: 0 },
		},
	});

	render(<UserGroupCodeManagement />);
	fireEvent.click(screen.getByRole('button', { name: 'Preview code management' }));

	const dialog = await screen.findByRole('dialog');
	expect(within(dialog).getByRole('heading', { name: 'Review code management changes' })).toBeTruthy();
	expect(within(dialog).getByText('Analysts')).toBeTruthy();
	expect(within(dialog).getByText('Adopt')).toBeTruthy();
	expect(within(dialog).getByText('Finance')).toBeTruthy();
	expect(within(dialog).getByText('Create')).toBeTruthy();
	expect(within(dialog).getByText('Settings will change')).toBeTruthy();
	expect(within(dialog).getByText('pending@example.com')).toBeTruthy();
	expect(within(dialog).getByText('2 chats and 1 story will lose access')).toBeTruthy();
});

it('shows compact code-management status without a superseded failure', () => {
	mocks.managementStatus.mockReturnValue({
		mode: 'code',
		pendingEmails: [],
		lastSuccess: {
			completedAt: '2026-11-13T13:47:53.000Z',
			actorName: 'Employee',
			actorEmail: 'employee@example.com',
		},
		latestFailure: {
			completedAt: '2026-11-13T13:43:17.000Z',
			errorMessage: 'User groups are already managed in the UI.',
		},
	});

	render(<UserGroupCodeManagement />);

	expect(screen.getByText(/user_groups.yaml is the source of truth/)).toBeTruthy();
	expect(screen.getByText(/Last synced.*Employee/)).toBeTruthy();
	expect(screen.getByRole('link', { name: 'Administrator guide' })).toBeTruthy();
	expect(screen.queryByText(/already managed in the UI/)).toBeNull();
	expect(screen.queryByText(/Hash|Changes:/)).toBeNull();
});
