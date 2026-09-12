// @vitest-environment jsdom

import {
	ALL_DOCS_CONTEXT_ACCESS,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_USER_GROUP_SSO_MAPPINGS,
} from '@nao/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasUserGroupEditorChanges, invalidateUserGroupQueries, UserGroupEditor } from './user-group-editor';
import { UserGroupEffectiveContext } from './user-group-effective-context';
import { UserGroupUserDetail } from './user-group-user-detail';
import { resolveUserGroupsPageTab, UserGroupsTable } from './user-groups-table';
import type { UserGroupEditorGroup } from './user-group-editor';
import type { ComponentProps, MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	useLicenseFeatures: vi.fn(),
	useQuery: vi.fn(),
	useMutation: vi.fn(),
	invalidateQueries: vi.fn(),
	mutate: vi.fn(),
	mutateAsync: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock('@/hooks/use-license', () => ({ useLicenseFeatures: mocks.useLicenseFeatures }));
vi.mock('@tanstack/react-query', () => ({
	useQuery: mocks.useQuery,
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
	useMutation: mocks.useMutation,
}));
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
	Link: ({
		children,
		onClick,
		to,
		className,
		title,
		'aria-label': ariaLabel,
	}: {
		children: ReactNode;
		onClick?: MouseEventHandler<HTMLAnchorElement>;
		to: string;
		className?: string;
		title?: string;
		'aria-label'?: string;
	}) => (
		<a href={to} onClick={onClick} className={className} title={title} aria-label={ariaLabel}>
			{children}
		</a>
	),
}));
vi.mock('@/main', () => ({
	trpc: {
		authConfig: {
			microsoft: { isSetup: { queryOptions: vi.fn(() => ({ queryKey: ['microsoft-config'] })) } },
			oidc: { getConfig: { queryOptions: vi.fn(() => ({ queryKey: ['oidc-config'] })) } },
		},
		project: {
			getDatabaseObjects: { queryKey: vi.fn(() => ['database-objects']) },
		},
		userGroup: {
			overview: { queryOptions: vi.fn(), queryKey: vi.fn(() => ['overview']) },
			contextCatalog: { queryOptions: vi.fn() },
			docsContextCatalog: { queryOptions: vi.fn() },
			effectiveAccess: { queryKey: vi.fn(() => ['effective-access']) },
			effectiveAccessForUser: { queryKey: vi.fn(() => ['effective-access-for-user']) },
			setMembership: { mutationOptions: vi.fn() },
			create: { mutationOptions: vi.fn() },
			update: { mutationOptions: vi.fn() },
			delete: { mutationOptions: vi.fn() },
		},
	},
}));
vi.mock('@/components/settings/tool-call-density-slider', () => ({
	ToolCallDensitySlider: ({
		onValueChange,
		disabled,
	}: {
		onValueChange: (density: 'compact' | 'detailed') => void;
		disabled?: boolean;
	}) => (
		<button onClick={() => onValueChange('compact')} disabled={disabled}>
			Density slider
		</button>
	),
}));
vi.mock('@/components/settings/user-group-context-access', () => ({
	UserGroupContextAccess: ({
		databaseAccess,
		onDatabaseAccessChange,
	}: {
		databaseAccess:
			| { mode: 'all'; strict: boolean }
			| { mode: 'restricted'; strict: boolean; grants: unknown[]; patterns: string[] };
		onDatabaseAccessChange: (access: {
			mode: 'all' | 'restricted';
			strict: boolean;
			grants?: unknown[];
			patterns?: string[];
		}) => void;
	}) => (
		<div>
			<button onClick={() => onDatabaseAccessChange({ mode: 'all', strict: databaseAccess.strict })}>
				Context permissions
			</button>
			<button onClick={() => onDatabaseAccessChange({ ...databaseAccess, strict: !databaseAccess.strict })}>
				Strict mode
			</button>
			{databaseAccess.mode === 'restricted' && (
				<>
					<button
						onClick={() =>
							onDatabaseAccessChange({
								...databaseAccess,
								patterns: [...databaseAccess.patterns, 'sales.*'],
							})
						}
					>
						Add test pattern
					</button>
					<span>{databaseAccess.patterns.join(', ')}</span>
				</>
			)}
		</div>
	),
	getDatabaseContextTableSelectionSummary: () => '0 tables',
}));
const allUsers = {
	id: 'all-users',
	name: 'All Users',
	isDefault: true,
	featureGrants: [],
	toolCallDensityPolicy: DEFAULT_TOOL_CALL_DENSITY_POLICY,
	databaseAccess: { mode: 'all' as const, strict: true },
	docsAccess: ALL_DOCS_CONTEXT_ACCESS,
	ssoMappings: EMPTY_USER_GROUP_SSO_MAPPINGS,
};
const analysts = {
	...allUsers,
	id: 'analysts',
	name: 'Analysts',
	isDefault: false,
	databaseAccess: { ...EMPTY_DATABASE_CONTEXT_ACCESS, strict: false },
	docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
};
const overview = {
	groups: [allUsers, analysts],
	users: [
		{
			id: 'project-user',
			name: 'Project User',
			email: 'project@example.com',
			role: 'user',
			status: 'active',
			source: 'project',
		},
		{
			id: 'organization-user',
			name: 'Organisation User',
			email: 'organization@example.com',
			role: 'viewer',
			status: 'active',
			source: 'organization',
		},
	],
	memberships: [
		{ groupId: 'all-users', userId: 'project-user' },
		{ groupId: 'all-users', userId: 'organization-user' },
		{ groupId: 'analysts', userId: 'project-user' },
	],
	ssoMemberships: [],
};

beforeEach(() => {
	mocks.mutate.mockReset();
	mocks.mutateAsync.mockReset();
	mocks.invalidateQueries.mockReset();
	mocks.useLicenseFeatures.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { sso: true, 'user-groups': true, 'row-level-security': false },
	});
	mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
		isLoading: false,
		isError: false,
		data:
			options?.queryKey?.[0] === 'oidc-config'
				? null
				: options?.queryKey?.[0] === 'microsoft-config'
					? false
					: overview,
	}));
	mocks.useMutation.mockReturnValue({
		mutate: mocks.mutate,
		mutateAsync: mocks.mutateAsync,
		isPending: false,
	});
	mocks.invalidateQueries.mockResolvedValue(undefined);
	mocks.navigate.mockReset();
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

describe('UserGroupsTable', () => {
	it.each([
		{ isLoading: true, isError: false },
		{ isLoading: false, isError: true },
	])('keeps User Groups visible while license resolution is unavailable', (licenseState) => {
		mocks.useLicenseFeatures.mockReturnValue({ ...licenseState, data: undefined });
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		expect(screen.getByRole('row', { name: /All Users/ })).toBeTruthy();
		expect(screen.getByRole('row', { name: /Analysts/ })).toBeTruthy();
	});

	it('renders free User Groups and keeps existing groups manageable', () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { 'user-groups': false },
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		expect(screen.getByRole('row', { name: /Analysts/ })).toBeTruthy();
		fireEvent.click(screen.getByRole('row', { name: /Analysts/ }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups/$groupId',
			params: { groupId: 'analysts' },
			search: { tab: 'features' },
		});
	});

	it('shows group rows and the create action', () => {
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		expect(screen.getByRole('tab', { name: 'Manage Groups' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('columnheader', { name: 'Group' })).toBeTruthy();
		expect(screen.getAllByRole('columnheader')).toHaveLength(3);
		expect(screen.getByRole('link', { name: 'All Users' })).toBeTruthy();
		expect(screen.getByText('Default')).toBeTruthy();
		expect(screen.getByRole('row', { name: /All Users/ })).toBeTruthy();
		expect(screen.getByRole('row', { name: /Analysts/ })).toBeTruthy();
		expect(screen.getByText('No features · All tables · Strict · All docs')).toBeTruthy();
		expect(screen.getByText('No features · No tables · Not strict · No docs')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Create group' })).toBeTruthy();
	});

	it('navigates from a group row and the create action', () => {
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		fireEvent.click(screen.getByRole('row', { name: /Analysts/ }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups/$groupId',
			params: { groupId: 'analysts' },
			search: { tab: 'features' },
		});

		fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
		expect(mocks.navigate).toHaveBeenLastCalledWith({
			to: '/settings/project/user-groups/$groupId',
			params: { groupId: 'new' },
			search: { tab: 'features' },
		});
	});

	it('creates on free below the custom-group limit and excludes All Users from the count', () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { 'user-groups': false },
		});
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				...overview,
				groups: [allUsers, analysts, { ...analysts, id: 'finance', name: 'Finance' }],
			},
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups/$groupId',
			params: { groupId: 'new' },
			search: { tab: 'features' },
		});
	});

	it('opens the Enterprise nudge instead of creating at the free custom-group limit', async () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { 'user-groups': false },
		});
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				...overview,
				groups: [
					allUsers,
					analysts,
					{ ...analysts, id: 'finance', name: 'Finance' },
					{ ...analysts, id: 'operations', name: 'Operations' },
				],
			},
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(
			await screen.findByText(
				'The free plan includes 3 custom groups. Upgrade to Enterprise to create unlimited groups.',
			),
		).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Upgrade to Enterprise' }).getAttribute('href')).toBe(
			'/settings/enterprise',
		);
	});

	it('creates beyond the free limit with the unlimited-groups entitlement', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				...overview,
				groups: [
					allUsers,
					analysts,
					{ ...analysts, id: 'finance', name: 'Finance' },
					{ ...analysts, id: 'operations', name: 'Operations' },
				],
			},
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups/$groupId',
			params: { groupId: 'new' },
			search: { tab: 'features' },
		});
	});

	it('shows the existing users table', () => {
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Users', 'Manage Groups']);
		expect(screen.getByRole('tab', { name: 'Users' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('columnheader', { name: 'User' })).toBeTruthy();
		expect(screen.getByText('Project Team')).toBeTruthy();
		expect(screen.getByText('Organisation Members')).toBeTruthy();
		expect(screen.getByText('Project User')).toBeTruthy();
		expect(screen.getByText('Organisation User')).toBeTruthy();
	});

	it('navigates from user rows but not from the groups dropdown', () => {
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		const userRow = screen.getByRole('row', { name: /Project User/ });
		expect(userRow.className).toContain('cursor-pointer');
		expect(userRow.className).toContain('hover:bg-primary/10');
		expect(screen.getByRole('link', { name: 'Project User' })).toBeTruthy();

		fireEvent.click(userRow);
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/project/user-groups/users/$userId',
			params: { userId: 'project-user' },
			search: { tab: 'features' },
		});

		mocks.navigate.mockReset();
		fireEvent.click(screen.getByRole('button', { name: /Manage groups for Project User/ }));
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it('updates group membership from the dropdown without opening the user', () => {
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		fireEvent.pointerDown(screen.getByRole('button', { name: /Manage groups for Organisation User/ }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			groupId: 'analysts',
			userId: 'organization-user',
			isMember: true,
		});
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(screen.getByRole('menuitemcheckbox', { name: 'Analysts' })).toBeTruthy();
	});

	it('marks SSO-managed memberships and prevents removing them manually', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'oidc-config'
					? null
					: options?.queryKey?.[0] === 'microsoft-config'
						? false
						: {
								...overview,
								memberships: [
									...overview.memberships,
									{ groupId: 'analysts', userId: 'organization-user' },
								],
								ssoMemberships: [
									{ groupId: 'analysts', userId: 'organization-user', provider: 'oidc' },
								],
							},
		}));
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		fireEvent.pointerDown(screen.getByRole('button', { name: /Manage groups for Organisation User/ }), {
			button: 0,
			ctrlKey: false,
		});
		const managedMembership = screen.getByRole('menuitemcheckbox', { name: 'Analysts, managed by SSO' });
		expect(managedMembership.getAttribute('data-disabled')).not.toBeNull();
		expect(screen.getByText('Managed by SSO')).toBeTruthy();
		fireEvent.click(managedMembership);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('keeps the users table columns fixed while group chips overflow inside their cell', () => {
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		const table = screen.getByRole('table');
		const headers = screen.getAllByRole('columnheader');
		const projectUserCells = screen.getByRole('row', { name: /Project User/ }).querySelectorAll('td');
		const groupsButton = screen.getByRole('button', { name: /Manage groups for Project User/ });

		expect(table.classList.contains('table-fixed')).toBe(true);
		expect(table.classList.contains('min-w-3xl')).toBe(true);
		expect(headers[0]?.classList.contains('w-[38%]')).toBe(true);
		expect(headers[1]?.classList.contains('w-1/5')).toBe(true);
		expect(headers[2]?.classList.contains('w-[42%]')).toBe(true);
		expect(projectUserCells[2]?.classList.contains('overflow-hidden')).toBe(true);
		expect(groupsButton.classList.contains('w-full')).toBe(true);
		expect(groupsButton.classList.contains('min-w-0')).toBe(true);
	});

	it('reports tab changes to the route', () => {
		const onTabChange = vi.fn();
		render(<UserGroupsTable tab='groups' onTabChange={onTabChange} />);

		fireEvent.click(screen.getByRole('tab', { name: 'Users' }));
		expect(onTabChange).toHaveBeenCalledWith('users');
	});

	it('defaults invalid search tabs to users and preserves groups links', () => {
		expect(resolveUserGroupsPageTab(undefined)).toBe('users');
		expect(resolveUserGroupsPageTab('invalid')).toBe('users');
		expect(resolveUserGroupsPageTab('groups')).toBe('groups');
	});
});

describe('UserGroupEditor', () => {
	it('invalidates effective user access and database objects with user-group queries', async () => {
		const queryClient = {
			invalidateQueries: mocks.invalidateQueries,
		} as unknown as Parameters<typeof invalidateUserGroupQueries>[0];

		await invalidateUserGroupQueries(queryClient);

		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['effective-access-for-user'] });
		expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['database-objects'] });
	});

	it('shows the active editor tab', () => {
		renderEditor();

		expect(screen.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tab', { name: 'Context' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Security' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Allowed features' })).toBeTruthy();
		expect(screen.queryByText('Context permissions')).toBeNull();
		expect(screen.queryByRole('navigation', { name: 'User group sections' })).toBeNull();
	});

	it('reports editor tab changes to the route', () => {
		const onTabChange = vi.fn();
		renderEditor('features', onTabChange);

		fireEvent.click(screen.getByRole('tab', { name: 'Context' }));
		expect(onTabChange).toHaveBeenCalledWith('context');
	});

	it('shows Conditional RULES in Context and the Enterprise RLS placeholder in Security', () => {
		const { rerender } = renderEditor('context');
		expect(screen.getByText('Context permissions')).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Conditional RULES' })).toBeTruthy();

		rerender(
			<UserGroupEditor
				group={analysts}
				activeTab='security'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);
		expect(screen.queryByRole('heading', { name: 'Conditional RULES' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Row-level security' })).toBeTruthy();
		expect(screen.getByText('Restricting which rows each group can access is not available yet.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Upgrade to Enterprise' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: /SSO group mapping/ })).toBeNull();
	});

	it('removes the Enterprise RLS marker when row-level security is licensed', () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { 'user-groups': true, 'row-level-security': true },
		});
		renderEditor('security');

		expect(screen.getByRole('heading', { name: 'Row-level security' })).toBeTruthy();
		expect(screen.getByText('Restricting which rows each group can access is not available yet.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Upgrade to Enterprise' })).toBeNull();
	});

	it('edits normalized OIDC mappings and includes them in the save payload', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'oidc-config'
					? { providerId: 'okta', providerName: 'Okta', rolesManagedByIdp: false }
					: options?.queryKey?.[0] === 'microsoft-config'
						? false
						: overview,
		}));
		renderEditor('security');

		fireEvent.change(screen.getByRole('textbox', { name: 'Okta group name' }), {
			target: { value: ' Finance-Team ' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
		expect(screen.getByText('finance-team')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(mocks.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				ssoMappings: {
					version: 1,
					providers: { oidc: ['finance-team'], microsoft: [] },
				},
			}),
		);
	});

	it('validates and saves Microsoft Entra group object IDs', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'oidc-config'
					? null
					: options?.queryKey?.[0] === 'microsoft-config'
						? true
						: overview,
		}));
		renderEditor('security');

		const input = screen.getByRole('textbox', { name: 'Microsoft Entra group object ID' });
		fireEvent.change(input, { target: { value: 'not-a-guid' } });
		expect(screen.getByText('Enter a valid Microsoft Entra group object ID.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Add group' }).hasAttribute('disabled')).toBe(true);

		fireEvent.change(input, { target: { value: 'A0B1C2D3-E4F5-6789-ABCD-EF0123456789' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
		expect(screen.getByText('a0b1c2d3-e4f5-6789-abcd-ef0123456789')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(mocks.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				ssoMappings: {
					version: 1,
					providers: {
						oidc: [],
						microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
					},
				},
			}),
		);
	});

	it('shows distinct OIDC and Microsoft mapping sections together', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'oidc-config'
					? { providerId: 'okta', providerName: 'Okta', rolesManagedByIdp: false }
					: options?.queryKey?.[0] === 'microsoft-config'
						? true
						: overview,
		}));
		renderEditor('security');

		expect(screen.getByRole('heading', { name: 'SSO group mapping — Okta' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'SSO group mapping — Microsoft Entra' })).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Okta group name' })).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Microsoft Entra group object ID' })).toBeTruthy();
	});

	it('explains why All Users cannot be mapped', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'oidc-config'
					? { providerId: 'okta', providerName: 'Okta', rolesManagedByIdp: false }
					: options?.queryKey?.[0] === 'microsoft-config'
						? false
						: overview,
		}));
		renderEditor('security', vi.fn(), allUsers);
		expect(screen.getByText(/All Users already includes everyone/)).toBeTruthy();
		expect(screen.queryByRole('textbox', { name: 'Okta group name' })).toBeNull();
	});

	it('hides actions for a clean existing group and keeps delete visible', () => {
		renderEditor();

		expect(screen.getByRole('button', { name: 'Delete group' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('resets existing edits on cancel', () => {
		renderEditor();
		const nameInput = screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement;
		expect(nameInput.value).toBe('Analysts');
		fireEvent.change(nameInput, { target: { value: 'Changed name' } });
		expect(nameInput.value).toBe('Changed name');
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(nameInput.value).toBe('Analysts');
		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('restores dynamic patterns on cancel', () => {
		renderEditor('context');

		fireEvent.click(screen.getByRole('button', { name: 'Add test pattern' }));
		expect(screen.getByText('sales.*')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByText('sales.*')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('tracks, restores, and saves strict mode', async () => {
		renderEditor('context');

		fireEvent.click(screen.getByRole('button', { name: 'Strict mode' }));
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Strict mode' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(mocks.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
			}),
		);
	});

	it.each([
		{ tab: 'features' as const, control: /Stories/ },
		{ tab: 'features' as const, control: 'Density slider' },
		{ tab: 'context' as const, control: 'Context permissions' },
	])('shows actions after changing $control', ({ tab, control }) => {
		renderEditor(tab);

		fireEvent.click(screen.getByRole('button', { name: control }));

		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('shows actions immediately for a new group with save disabled', () => {
		renderEditor('features', vi.fn(), 'new');

		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('hides actions after refreshed group data matches the draft', () => {
		const { rerender } = renderEditor();
		fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), {
			target: { value: 'Analytics' },
		});

		rerender(
			<UserGroupEditor
				group={{ ...analysts, name: 'Analytics' }}
				activeTab='features'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('compares feature and database grants semantically', () => {
		const schemaGrant = {
			kind: 'schema' as const,
			databaseType: 'postgres',
			database: 'warehouse',
			schema: 'public',
		};
		const tableGrant = {
			kind: 'table' as const,
			databaseType: 'postgres',
			database: 'warehouse',
			schema: 'sales',
			table: 'orders',
		};
		const group: UserGroupEditorGroup = {
			...analysts,
			featureGrants: ['story-creation', 'automation-creation'],
			databaseAccess: {
				mode: 'restricted',
				strict: true,
				grants: [schemaGrant, tableGrant],
				patterns: ['sales.*'],
			},
			docsAccess: {
				mode: 'restricted',
				grants: [
					{ kind: 'folder', path: 'finance' },
					{ kind: 'file', path: 'legal/terms.md' },
				],
			},
		};

		expect(
			hasUserGroupEditorChanges(group, {
				name: ' Analysts ',
				featureGrants: ['automation-creation', 'story-creation', 'story-creation'],
				toolCallDensityPolicy: { ...group.toolCallDensityPolicy },
				databaseAccess: {
					mode: 'restricted',
					strict: true,
					grants: [tableGrant, schemaGrant, tableGrant],
					patterns: [' SALES.* ', 'sales.*'],
				},
				docsAccess: {
					mode: 'restricted',
					grants: [
						{ kind: 'file', path: 'legal/terms.md' },
						{ kind: 'folder', path: 'finance' },
						{ kind: 'folder', path: 'finance' },
					],
				},
			}),
		).toBe(false);
		expect(
			hasUserGroupEditorChanges(group, {
				name: group.name,
				featureGrants: group.featureGrants,
				toolCallDensityPolicy: group.toolCallDensityPolicy,
				databaseAccess: {
					mode: 'restricted',
					strict: true,
					grants: [schemaGrant, tableGrant],
					patterns: [],
				},
			}),
		).toBe(true);
		expect(
			hasUserGroupEditorChanges(group, {
				name: group.name,
				featureGrants: group.featureGrants,
				toolCallDensityPolicy: group.toolCallDensityPolicy,
				databaseAccess: group.databaseAccess,
				docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			}),
		).toBe(true);
		expect(
			hasUserGroupEditorChanges(group, {
				name: group.name,
				featureGrants: group.featureGrants,
				toolCallDensityPolicy: group.toolCallDensityPolicy,
				databaseAccess: { ...group.databaseAccess, strict: false },
			}),
		).toBe(true);
		expect(
			hasUserGroupEditorChanges(group, {
				name: group.name,
				featureGrants: group.featureGrants,
				toolCallDensityPolicy: { ...group.toolCallDensityPolicy, canChange: false },
				databaseAccess: group.databaseAccess,
			}),
		).toBe(true);
	});
});

describe('UserGroupUserDetail', () => {
	it('shows compact memberships and static feature access', () => {
		const unrelatedGroup = { ...analysts, id: 'finance', name: 'Finance' };
		renderUserDetail({ groups: [allUsers, analysts, unrelatedGroup] });

		expect(screen.getByRole('heading', { name: 'Project User' })).toBeTruthy();
		expect(screen.getByText('project@example.com')).toBeTruthy();
		expect(screen.getByText('Active')).toBeTruthy();
		expect(screen.getByText('User')).toBeTruthy();
		expect(screen.getAllByText('All Users').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Analysts').length).toBeGreaterThan(0);
		expect(screen.queryByText('Finance')).toBeNull();
		expect(screen.queryByText('Default')).toBeNull();
		expect(screen.getByText('1 feature · 0 tables · 0 docs · Strict')).toBeTruthy();

		const stories = screen.getByRole('article', { name: /Stories.*Allowed/ });
		const automations = screen.getByRole('article', { name: /Automations.*Not allowed/ });
		expect(stories.className).toContain('border-primary');
		expect(stories.className).toContain('ring-1');
		expect(automations.className).not.toContain('border-primary');
		expect(screen.getByTestId('story-creation-preview')).toBeTruthy();
		expect(screen.getByTestId('automation-creation-preview')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Stories/ })).toBeNull();
		expect(stories.className).not.toMatch(/cursor-pointer|hover:|focus-visible:/);
		expect(stories.querySelector('.lucide-check')).toBeNull();
		expect(screen.queryByText('Allowed')).toBeNull();
		expect(screen.queryByText('Not allowed')).toBeNull();
		expect(screen.getByText('Compact')).toBeTruthy();
		expect(screen.getByText('Member may change it')).toBeTruthy();
		expect(screen.getByText('Yes')).toBeTruthy();
		expect(screen.queryByRole('switch')).toBeNull();
		expect(screen.queryByText('Density slider')).toBeNull();
	});

	it('counts current effective access without overlap, including Everything mode', () => {
		const contextObjects = [
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
		];
		const docsEntries = [
			{ kind: 'folder' as const, path: 'finance' },
			{ kind: 'file' as const, path: 'finance/kpis.md' },
			{ kind: 'file' as const, path: 'finance/kpis.md' },
			{ kind: 'file' as const, path: 'readme.md' },
		];
		renderUserDetail({
			contextObjects,
			docsEntries,
			effectiveAccess: {
				features: { 'story-creation': true, 'automation-creation': true },
				toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: false },
				databaseAccess: { mode: 'all', strict: false },
				docsAccess: { mode: 'all' },
			},
		});

		expect(screen.getByText('2 features · 2 tables · 2 docs · Not strict')).toBeTruthy();
		expect(screen.queryByText(/All tables|All docs/)).toBeNull();
	});

	it('shows only allowed context and static dynamic patterns', () => {
		const contextObjects = [
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'secrets' },
		];
		const docsEntries = [
			{ kind: 'folder' as const, path: 'finance' },
			{ kind: 'file' as const, path: 'finance/kpis.md' },
			{ kind: 'file' as const, path: 'private.md' },
		];
		renderUserDetail({
			activeTab: 'context',
			contextObjects,
			docsEntries,
			effectiveAccess: {
				features: { 'story-creation': true, 'automation-creation': false },
				toolCallDensityPolicy: { defaultDensity: 'compact', canChange: true },
				databaseAccess: {
					mode: 'restricted',
					strict: true,
					grants: [
						{
							kind: 'table',
							databaseType: 'postgres',
							database: 'app',
							schema: 'public',
							table: 'users',
						},
					],
					patterns: ['public.o*'],
				},
				docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'finance/kpis.md' }] },
			},
		});

		expect(screen.getByText('Specific selection')).toBeTruthy();
		expect(screen.getByText('Strict')).toBeTruthy();
		expect(screen.getByText('2 tables · 1 doc')).toBeTruthy();
		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(screen.queryByRole('switch')).toBeNull();
		expect(screen.queryByRole('button', { name: /Everything|Specific selection/ })).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		expect(screen.getByText('users')).toBeTruthy();
		expect(screen.getByText('orders')).toBeTruthy();
		expect(screen.queryByText('secrets')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Expand docs folder' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand finance folder' }));
		expect(screen.getByText('kpis.md')).toBeTruthy();
		expect(screen.queryByText('private.md')).toBeNull();
		expect(screen.getByText('public.o*')).toBeTruthy();
		expect(screen.getByText('1 match')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Remove dynamic pattern/ })).toBeNull();
	});

	it('shows current catalog content in Everything mode and clean catalog states', () => {
		const contextObjects = [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }];
		const docsEntries = [{ kind: 'file' as const, path: 'readme.md' }];
		const { rerender } = renderUserDetail({
			activeTab: 'context',
			contextObjects,
			docsEntries,
			effectiveAccess: {
				features: { 'story-creation': false, 'automation-creation': false },
				toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: false },
				databaseAccess: { mode: 'all', strict: false },
				docsAccess: { mode: 'all' },
			},
		});

		expect(screen.getByText('Everything')).toBeTruthy();
		expect(screen.getByText('Not strict')).toBeTruthy();
		expect(screen.getByText('1 table · 1 doc')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand docs folder' }));
		expect(screen.getByText('users')).toBeTruthy();
		expect(screen.getByText('readme.md')).toBeTruthy();

		rerender(
			<UserGroupEffectiveContext
				databaseAccess={{ mode: 'all', strict: true }}
				docsAccess={{ mode: 'all' }}
				contextObjects={[]}
				docsEntries={[]}
				databaseCatalogState='loading'
				docsCatalogState='error'
			/>,
		);
		expect(screen.getByText('Loading...')).toBeTruthy();
		expect(screen.getByText('Failed to load')).toBeTruthy();
	});

	it('keeps the security placeholder', () => {
		renderUserDetail({ activeTab: 'security' });
		expect(screen.getByText('Row-level security is not available yet.')).toBeTruthy();
	});
});

function renderEditor(
	activeTab: 'features' | 'context' | 'security' = 'features',
	onTabChange = vi.fn(),
	group: UserGroupEditorGroup | 'new' = analysts,
) {
	return render(
		<UserGroupEditor
			group={group}
			activeTab={activeTab}
			onTabChange={onTabChange}
			onCancelNew={vi.fn()}
			onCreated={vi.fn()}
			onDeleted={vi.fn()}
		/>,
	);
}

function renderUserDetail({
	groups = [allUsers, analysts],
	activeTab = 'features',
	contextObjects = [],
	docsEntries = [],
	effectiveAccess = {
		features: { 'story-creation': true, 'automation-creation': false },
		toolCallDensityPolicy: { defaultDensity: 'compact', canChange: true },
		databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
		docsAccess: { mode: 'restricted', grants: [] },
	},
}: {
	groups?: UserGroupEditorGroup[];
	activeTab?: 'features' | 'context' | 'security';
	contextObjects?: Array<{ databaseType: string; database: string; schema: string; table: string }>;
	docsEntries?: Array<{ kind: 'folder' | 'file'; path: string }>;
	effectiveAccess?: ComponentProps<typeof UserGroupUserDetail>['effectiveAccess'];
} = {}) {
	return render(createUserDetail(activeTab, groups, contextObjects, docsEntries, effectiveAccess));
}

function createUserDetail(
	activeTab: 'features' | 'context' | 'security',
	groups: UserGroupEditorGroup[] = [allUsers, analysts],
	contextObjects: Array<{ databaseType: string; database: string; schema: string; table: string }> = [],
	docsEntries: Array<{ kind: 'folder' | 'file'; path: string }> = [],
	effectiveAccess: ComponentProps<typeof UserGroupUserDetail>['effectiveAccess'] = {
		features: { 'story-creation': true, 'automation-creation': false },
		toolCallDensityPolicy: { defaultDensity: 'compact', canChange: true },
		databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
		docsAccess: { mode: 'restricted', grants: [] },
	},
) {
	return (
		<UserGroupUserDetail
			user={{ ...overview.users[0], role: 'user', status: 'active' }}
			groups={groups}
			memberships={overview.memberships}
			effectiveAccess={effectiveAccess}
			contextObjects={contextObjects}
			docsEntries={docsEntries}
			activeTab={activeTab}
			onTabChange={vi.fn()}
		/>
	);
}
