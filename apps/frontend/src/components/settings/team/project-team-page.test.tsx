// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { ProjectTeamTabPage } from '@/routes/_sidebar-layout.settings.project.team';

const mocks = vi.hoisted(() => ({
	addUser: vi.fn(),
	invalidateQueries: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: (options: { mutationKey: string[] }) => ({
		mutateAsync: options.mutationKey[0] === 'add-user' ? mocks.addUser : vi.fn(),
	}),
	useQuery: mocks.useQuery,
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: unknown) => options,
}));
vi.mock('@/components/settings/team', async () => {
	const actual = await import('@/components/settings/team/add-member-dialog');
	return {
		...actual,
		EditMemberDialog: () => null,
		NewCredentialsDialog: () => null,
		RemoveMemberDialog: () => null,
		TeamMembersList: () => <div>Team members</div>,
	};
});
vi.mock('@/components/ui/settings-card', () => ({
	SettingsCard: ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
		<div>
			{action}
			{children}
		</div>
	),
}));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => ({ isAdmin: true }) }));
vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'admin-id' } } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		account: {
			resetPassword: { mutationOptions: () => ({ mutationKey: ['reset-password'] }) },
		},
		project: {
			listAllUsersWithRoles: {
				queryKey: () => ['project-members'],
				queryOptions: () => ({ queryKey: ['project-members'] }),
			},
			removeProjectMember: { mutationOptions: () => ({ mutationKey: ['remove-user'] }) },
		},
		system: {
			getPublicConfig: { queryOptions: () => ({ queryKey: ['system-config'] }) },
		},
		user: {
			addUserToProject: { mutationOptions: () => ({ mutationKey: ['add-user'] }) },
			modify: { mutationOptions: () => ({ mutationKey: ['modify-user'] }) },
		},
		userGroup: {
			overview: {
				queryKey: () => ['user-group-overview'],
				queryOptions: () => ({ queryKey: ['user-group-overview'] }),
			},
		},
	},
}));

const userGroupOverview = {
	groups: [
		{ id: 'all-users', name: 'All Users', isDefault: true },
		{ id: 'analysts', name: 'Analysts', isDefault: false },
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.addUser.mockResolvedValue({ newUser: { id: 'new-user' } });
	mocks.invalidateQueries.mockResolvedValue(undefined);
	mocks.useQuery.mockImplementation(({ queryKey }) => {
		if (queryKey[0] === 'project-members') {
			return { data: [], isLoading: false };
		}
		if (queryKey[0] === 'system-config') {
			return { data: { naoMode: 'self-hosted' } };
		}
		return { data: userGroupOverview, isLoading: false };
	});
	vi.stubGlobal(
		'ResizeObserver',
		vi.fn(() => ({
			observe: vi.fn(),
			disconnect: vi.fn(),
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('ProjectTeamTabPage group onboarding', () => {
	it('loads groups while open, submits IDs, and refreshes groups', async () => {
		render(<ProjectTeamTabPage />);

		expect(mocks.useQuery).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ['user-group-overview'], enabled: false }),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
		expect(mocks.useQuery).toHaveBeenLastCalledWith(
			expect.objectContaining({ queryKey: ['user-group-overview'], enabled: true }),
		);

		fireEvent.pointerDown(screen.getByRole('button', { name: /Select user groups/ }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

		await waitFor(() =>
			expect(mocks.addUser).toHaveBeenCalledWith({
				email: 'person@example.com',
				name: undefined,
				groupIds: ['analysts'],
			}),
		);
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project-members'] });
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user-group-overview'] });
	});

	it('keeps the group query and picker available without an unlimited-groups entitlement', () => {
		render(<ProjectTeamTabPage />);
		fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));

		expect(mocks.useQuery).toHaveBeenLastCalledWith(
			expect.objectContaining({ queryKey: ['user-group-overview'], enabled: true }),
		);
		expect(screen.getByRole('button', { name: /Select user groups.*All Users/ })).toBeTruthy();
	});
});
