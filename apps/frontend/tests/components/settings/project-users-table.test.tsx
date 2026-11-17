// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver } from '../../helpers/browser-stubs';
import { openDropdownMenu } from '../../helpers/dropdown-menu';
import type { MouseEventHandler, ReactNode } from 'react';
import { ReadOnlyProjectUsers, ProjectUsersTable } from '@/components/settings/project-users-table';

const mocks = vi.hoisted(() => ({
	addUser: vi.fn(),
	modifyUser: vi.fn(),
	removeUser: vi.fn(),
	resetPassword: vi.fn(),
	invalidateQueries: vi.fn(),
	invalidateUserGroupQueries: vi.fn(),
	useQuery: vi.fn(),
	setMembership: vi.fn(),
	setMemberships: vi.fn(),
	setMembershipsRequest: vi.fn(),
	setMembershipsMutationFn: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: (options: { mutationKey: string[]; mutationFn?: (input: unknown) => Promise<unknown> }) => {
		if (options.mutationKey[0] === 'set-memberships') {
			mocks.setMembershipsMutationFn.mockImplementation(options.mutationFn ?? (() => Promise.resolve()));
		}
		const mutateAsync = {
			'add-user': mocks.addUser,
			'modify-user': mocks.modifyUser,
			'remove-user': mocks.removeUser,
			'reset-password': mocks.resetPassword,
		}[options.mutationKey[0]];
		const mutate = options.mutationKey[0] === 'set-memberships' ? mocks.setMemberships : mocks.setMembership;
		return { mutateAsync, mutate, reset: vi.fn(), isPending: false };
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
			setMemberships: { mutationKey: () => ['set-memberships'] },
		},
	},
	trpcClient: {
		userGroup: {
			setMemberships: { mutate: mocks.setMembershipsRequest },
		},
	},
}));

const groups = [
	{ id: 'all-users', name: 'All Users', isDefault: true },
	{ id: 'analysts', name: 'Analysts', isDefault: false },
	{ id: 'finance', name: 'Finance', isDefault: false },
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
	stubResizeObserver();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('ProjectUsersTable member management', () => {
	it('adds a member with the selected groups and refreshes members', async () => {
		renderTable();

		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
		openDropdownMenu(/Select user groups/);
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

		openProjectUserActions();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

		await waitFor(() => expect(mocks.removeUser).toHaveBeenCalledWith({ userId: 'project-user' }));
		expect(mocks.invalidateUserGroupQueries).toHaveBeenCalledOnce();
	});

	it('opens the edit dialog for a project member', () => {
		renderTable();

		openProjectUserActions();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Edit user' }));

		expect(screen.getByText('Editing Project User')).toBeTruthy();
	});

	it('resets a password outside cloud mode and shows the new credentials', async () => {
		renderTable();

		await resetProjectUserPassword();

		await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith({ userId: 'project-user' }));
		expect(await screen.findByText('Password: generated-password')).toBeTruthy();
	});

	it('shows the error in the dialog when resetting a password fails', async () => {
		mocks.resetPassword.mockRejectedValue(new Error('Account does not use password authentication'));
		renderTable();

		await resetProjectUserPassword();

		expect(await screen.findByText('Account does not use password authentication')).toBeTruthy();
		expect(screen.queryByText(/^Password:/)).toBeNull();
	});

	it('hides the reset password action in cloud mode', () => {
		mocks.useQuery.mockReturnValue({ data: { naoMode: 'cloud' } });
		renderTable();

		openProjectUserActions();

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

describe('ProjectUsersTable filtering and bulk group assignment', () => {
	beforeEach(() => {
		Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
	});

	it('searches users by name or email across both sections', () => {
		renderTable();
		const search = screen.getByRole('searchbox', { name: 'Search users' });

		fireEvent.change(search, { target: { value: ' ORGANIZATION@ ' } });
		expect(screen.getByText('Organisation User')).toBeTruthy();
		expect(screen.queryByText('Project User')).toBeNull();
		expect(screen.queryByText('Project Team')).toBeNull();

		fireEvent.change(search, { target: { value: 'admin' } });
		expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
		expect(screen.queryByText('Organisation Members')).toBeNull();

		fireEvent.change(search, { target: { value: 'nobody' } });
		expect(screen.getByText('No users match your filters.')).toBeTruthy();
	});

	it('filters users by group and finds users without a custom group', () => {
		renderTable();

		selectGroupFilter('Analysts');
		expect(screen.getByText('Project User')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
		expect(screen.queryByText('Organisation User')).toBeNull();

		selectGroupFilter('No custom group');
		expect(screen.queryByText('Project User')).toBeNull();
		expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
		expect(screen.getByText('Organisation User')).toBeTruthy();
	});

	it('adds several selected users to a group at once without opening them', async () => {
		const onOpenUser = vi.fn();
		renderTable(onOpenUser);

		expect(screen.queryByRole('toolbar', { name: 'Bulk group actions' })).toBeNull();
		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Admin' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Organisation User' }));
		expect(onOpenUser).not.toHaveBeenCalled();
		expect(screen.getByText('2 users selected')).toBeTruthy();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Add to group' }), { button: 0, ctrlKey: false });
		expect(screen.queryByRole('menuitem', { name: 'All Users' })).toBeNull();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Finance' }));

		expect(mocks.setMemberships).toHaveBeenCalledWith(
			{ groupId: 'finance', userIds: ['admin-id', 'organization-user'], isMember: true },
			expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) }),
		);
		const { onSuccess, onSettled } = mocks.setMemberships.mock.calls[0][1];
		await act(async () => {
			onSuccess();
			await onSettled();
		});
		expect(mocks.invalidateUserGroupQueries).toHaveBeenCalledOnce();
		expect(screen.queryByText(/selected/)).toBeNull();
	});

	it('selects only the users visible through the current filters', () => {
		renderTable();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Admin' }));
		fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), { target: { value: 'project' } });
		expect(screen.queryByText(/selected/)).toBeNull();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select all users' }));
		expect(screen.getByText('1 user selected')).toBeTruthy();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Remove from group' }), { button: 0, ctrlKey: false });
		fireEvent.click(screen.getByRole('menuitem', { name: 'Analysts' }));

		expect(mocks.setMemberships).toHaveBeenCalledWith(
			{ groupId: 'analysts', userIds: ['project-user'], isMember: false },
			expect.anything(),
		);
	});

	it('clears the selection from the bulk toolbar', () => {
		renderTable();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select all users' }));
		expect(screen.getByText('3 users selected')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'Select all users' }).getAttribute('data-state')).toBe('checked');

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Admin' }));
		expect(screen.getByRole('checkbox', { name: 'Select all users' }).getAttribute('data-state')).toBe(
			'indeterminate',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
		expect(screen.queryByText(/selected/)).toBeNull();
		expect(mocks.setMemberships).not.toHaveBeenCalled();
	});

	it('skips users whose membership in the group is managed by SSO and names them', () => {
		renderTable(vi.fn(), new Set(['analysts:project-user']));

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select all users' }));
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Remove from group' }), { button: 0, ctrlKey: false });
		fireEvent.click(screen.getByRole('menuitem', { name: 'Analysts' }));

		expect(mocks.setMemberships).toHaveBeenCalledWith(
			{ groupId: 'analysts', userIds: ['admin-id', 'organization-user'], isMember: false },
			expect.anything(),
		);
		expect(screen.getByText('Skipped Project User: SSO manages their membership in Analysts.')).toBeTruthy();
	});

	it('changes nothing when every selected membership is managed by SSO', () => {
		renderTable(vi.fn(), new Set(['analysts:project-user']));

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Project User' }));
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Add to group' }), { button: 0, ctrlKey: false });
		fireEvent.click(screen.getByRole('menuitem', { name: 'Analysts' }));

		expect(mocks.setMemberships).not.toHaveBeenCalled();
		expect(screen.getByText('Skipped Project User: SSO manages their membership in Analysts.')).toBeTruthy();
	});

	it('sends large selections in batches the endpoint accepts', async () => {
		renderTable();
		const userIds = Array.from({ length: 2_500 }, (_, index) => `user-${index}`);

		await mocks.setMembershipsMutationFn({ groupId: 'finance', userIds, isMember: true });

		expect(mocks.setMembershipsRequest.mock.calls.map(([input]) => input.userIds.length)).toEqual([
			1_000, 1_000, 500,
		]);
		expect(mocks.setMembershipsRequest).toHaveBeenLastCalledWith({
			groupId: 'finance',
			userIds: userIds.slice(2_000),
			isMember: true,
		});
	});
});

describe('ProjectUsersTable pagination', () => {
	it('hides pagination for small teams', () => {
		renderTable();

		expect(screen.queryByRole('button', { name: 'Go to next page' })).toBeNull();
	});

	it('pages read-only members and continues into the organisation section', () => {
		const { members, organizationMembers } = makeManyUsers();
		render(<ProjectUsersTable canManage={false} projectUsers={members} organizationUsers={organizationMembers} />);

		expect(screen.getByText('Member 49')).toBeTruthy();
		expect(screen.queryByText('Member 50')).toBeNull();
		expect(screen.queryByText('Organisation Members')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));

		expect(screen.getByText('Member 59')).toBeTruthy();
		expect(screen.getByText('Organisation Members')).toBeTruthy();
		expect(screen.getByText('Org Member 4')).toBeTruthy();
		expect(screen.queryByText('Member 0')).toBeNull();
	});

	it('returns to the first page when the filters change', () => {
		renderManyManagedUsers();
		fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
		expect(screen.getByText('Page 2 of 2')).toBeTruthy();

		fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), { target: { value: 'member5' } });

		expect(screen.getByText('Member 5')).toBeTruthy();
		expect(screen.getByText('Member 59')).toBeTruthy();
		expect(screen.getByText('Page 1 of 1')).toBeTruthy();
	});

	it('selects every matching user across pages', () => {
		renderManyManagedUsers();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select all users' }));

		expect(screen.getByText('65 users selected')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'Select all users' }).getAttribute('data-state')).toBe('checked');
	});
});

function makeManyUsers() {
	const members = Array.from({ length: 60 }, (_, index) => ({
		...projectUser,
		id: `member-${index}`,
		name: `Member ${index}`,
		email: `member${index}@example.com`,
	}));
	const organizationMembers = Array.from({ length: 5 }, (_, index) => ({
		...organizationUser,
		id: `org-member-${index}`,
		name: `Org Member ${index}`,
		email: `org-member${index}@example.com`,
	}));
	return { members, organizationMembers };
}

function renderManyManagedUsers() {
	const { members, organizationMembers } = makeManyUsers();
	return render(
		<ProjectUsersTable
			canManage
			projectUsers={members}
			organizationUsers={organizationMembers}
			groups={groups}
			membershipKeys={new Set()}
			ssoMembershipKeys={new Set()}
			onOpenUser={vi.fn()}
		/>,
	);
}

function selectGroupFilter(optionName: string) {
	fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filter by group' }), { key: 'Enter' });
	fireEvent.click(screen.getByRole('option', { name: optionName }));
}

function renderTable(onOpenUser = vi.fn(), ssoMembershipKeys = new Set<string>()) {
	return render(
		<ProjectUsersTable
			canManage
			projectUsers={[admin, projectUser]}
			organizationUsers={[organizationUser]}
			groups={groups}
			membershipKeys={
				new Set([
					'all-users:admin-id',
					'all-users:project-user',
					'all-users:organization-user',
					'analysts:project-user',
				])
			}
			ssoMembershipKeys={ssoMembershipKeys}
			onOpenUser={onOpenUser}
		/>,
	);
}

function openProjectUserActions() {
	openDropdownMenu('Actions for Project User');
}

async function resetProjectUserPassword() {
	openProjectUserActions();
	fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
}
