// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadOnlyProjectUsers, ProjectUsersTable } from './project-users-table';
import type { MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	addUser: vi.fn(),
	modifyUser: vi.fn(),
	removeUser: vi.fn(),
	resetPassword: vi.fn(),
	invalidateQueries: vi.fn(),
	invalidateUserGroupQueries: vi.fn(),
	useQuery: vi.fn(),
	setMembership: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: (options: { mutationKey: string[] }) => {
		const mutateAsync = {
			'add-user': mocks.addUser,
			'modify-user': mocks.modifyUser,
			'remove-user': mocks.removeUser,
			'reset-password': mocks.resetPassword,
		}[options.mutationKey[0]];
		return { mutateAsync, mutate: mocks.setMembership, isPending: false };
	},
	useQuery: mocks.useQuery,
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		onClick,
		to,
		className,
	}: {
		children: ReactNode;
		onClick?: MouseEventHandler<HTMLAnchorElement>;
		to: string;
		className?: string;
	}) => (
		<a href={to} onClick={onClick} className={className}>
			{children}
		</a>
	),
}));
vi.mock('@/components/settings/team', async () => {
	const addMemberDialog = await import('@/components/settings/team/add-member-dialog');
	const removeMemberDialog = await import('@/components/settings/team/remove-member-dialog');
	return {
		...addMemberDialog,
		...removeMemberDialog,
		EditMemberDialog: ({ open, member }: { open: boolean; member: { name: string } | null }) =>
			open ? <div>Editing {member?.name}</div> : null,
		NewCredentialsDialog: ({ open, credentials }: { open: boolean; credentials: { password: string } | null }) =>
			open ? <div>Password: {credentials?.password}</div> : null,
	};
});
vi.mock('@/components/settings/user-group-editor', () => ({
	invalidateUserGroupQueries: mocks.invalidateUserGroupQueries,
}));
vi.mock('@/lib/auth-client', () => ({
	useSession: () => ({ data: { user: { id: 'admin-id' } } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		account: {
			resetPassword: { mutationOptions: () => ({ mutationKey: ['reset-password'] }) },
		},
		project: {
			listAllUsersWithRoles: { queryKey: () => ['project-members'] },
			listUsersWithAccess: { queryOptions: () => ({ queryKey: ['users-with-access'] }) },
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
			setMembership: { mutationOptions: () => ({ mutationKey: ['set-membership'] }) },
		},
	},
}));

const groups = [
	{ id: 'all-users', name: 'All Users', isDefault: true },
	{ id: 'analysts', name: 'Analysts', isDefault: false },
];
const admin = {
	id: 'admin-id',
	name: 'Admin',
	email: 'admin@example.com',
	role: 'admin' as const,
	status: 'active' as const,
	source: 'project' as const,
};
const projectUser = {
	id: 'project-user',
	name: 'Project User',
	email: 'project@example.com',
	role: 'user' as const,
	status: 'active' as const,
	source: 'project' as const,
};
const organizationUser = {
	id: 'organization-user',
	name: 'Organisation User',
	email: 'organization@example.com',
	role: 'viewer' as const,
	status: 'active' as const,
	source: 'organization' as const,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.addUser.mockResolvedValue({ newUser: { id: 'new-user' } });
	mocks.removeUser.mockResolvedValue(undefined);
	mocks.resetPassword.mockResolvedValue({ password: 'generated-password' });
	mocks.invalidateQueries.mockResolvedValue(undefined);
	mocks.invalidateUserGroupQueries.mockResolvedValue(undefined);
	mocks.useQuery.mockReturnValue({ data: { naoMode: 'self-hosted' } });
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

describe('ProjectUsersTable member management', () => {
	it('adds a member with the selected groups and refreshes members', async () => {
		renderTable();

		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
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
		expect(mocks.invalidateUserGroupQueries).toHaveBeenCalledOnce();
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project-members'] });
	});

	it('shows the generated credentials when a new user is created', async () => {
		mocks.addUser.mockResolvedValue({ newUser: { id: 'new-user' }, password: 'generated-password' });
		renderTable();

		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

		expect(await screen.findByText('Password: generated-password')).toBeTruthy();
	});

	it('offers member actions for other project members only', () => {
		renderTable();

		expect(screen.getByRole('button', { name: 'Actions for Project User' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Actions for Admin' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Actions for Organisation User' })).toBeNull();
		expect(screen.getByText('(you)')).toBeTruthy();
	});

	it('removes a project member after confirmation', async () => {
		renderTable();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Project User' }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(mocks.removeUser).toHaveBeenCalledWith({ userId: 'project-user' }));
		expect(mocks.invalidateUserGroupQueries).toHaveBeenCalledOnce();
	});

	it('opens the edit dialog for a project member', () => {
		renderTable();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Project User' }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitem', { name: 'Edit user' }));

		expect(screen.getByText('Editing Project User')).toBeTruthy();
	});

	it('resets a password outside cloud mode and shows the new credentials', async () => {
		renderTable();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Project User' }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));

		await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith({ userId: 'project-user' }));
		expect(await screen.findByText('Password: generated-password')).toBeTruthy();
	});

	it('shows the error in the dialog when resetting a password fails', async () => {
		mocks.resetPassword.mockRejectedValue(new Error('Account does not use password authentication'));
		renderTable();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Project User' }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));

		expect(await screen.findByText('Account does not use password authentication')).toBeTruthy();
		expect(screen.queryByText(/^Password:/)).toBeNull();
	});

	it('hides the reset password action in cloud mode', () => {
		mocks.useQuery.mockReturnValue({ data: { naoMode: 'cloud' } });
		renderTable();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Project User' }), {
			button: 0,
			ctrlKey: false,
		});

		expect(screen.getByRole('menuitem', { name: 'Edit user' })).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: 'Reset password' })).toBeNull();
	});
});

describe('ReadOnlyProjectUsers', () => {
	it('lists project and organisation users without management controls', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: [admin, projectUser, organizationUser],
		});
		render(<ReadOnlyProjectUsers />);

		expect(mocks.useQuery).toHaveBeenCalledWith({ queryKey: ['users-with-access'] });
		expect(screen.getByText('Project Team')).toBeTruthy();
		expect(screen.getByText('Organisation Members')).toBeTruthy();
		expect(screen.getByText('Project User')).toBeTruthy();
		expect(screen.getByText('Organisation User')).toBeTruthy();
		expect(screen.getByText('(you)')).toBeTruthy();
		expect(screen.queryByRole('columnheader', { name: 'Groups' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Manage groups for/ })).toBeNull();
		expect(screen.queryByRole('link')).toBeNull();
	});
});

function renderTable() {
	return render(
		<ProjectUsersTable
			canManage
			projectUsers={[admin, projectUser]}
			organizationUsers={[organizationUser]}
			groups={groups}
			membershipKeys={new Set(['all-users:admin-id', 'all-users:project-user', 'all-users:organization-user'])}
			ssoMembershipKeys={new Set()}
			onOpenUser={vi.fn()}
		/>,
	);
}
