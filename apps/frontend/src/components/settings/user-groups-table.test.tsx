// @vitest-environment jsdom

import {
	ALL_DOCS_CONTEXT_ACCESS,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
} from '@nao/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasUserGroupEditorChanges, UserGroupEditor } from './user-group-editor';
import { resolveUserGroupsPageTab, UserGroupsTable } from './user-groups-table';
import type { UserGroupEditorGroup } from './user-group-editor';
import type { MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	useLicenseFeatures: vi.fn(),
	useQuery: vi.fn(),
	useMutation: vi.fn(),
	invalidateQueries: vi.fn(),
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
	Link: ({ children, onClick }: { children: ReactNode; onClick?: MouseEventHandler<HTMLAnchorElement> }) => (
		<a href='#group' onClick={onClick}>
			{children}
		</a>
	),
}));
vi.mock('@/main', () => ({
	trpc: {
		userGroup: {
			overview: { queryOptions: vi.fn(), queryKey: vi.fn(() => ['overview']) },
			contextCatalog: { queryOptions: vi.fn() },
			docsContextCatalog: { queryOptions: vi.fn() },
			effectiveAccess: { queryKey: vi.fn(() => ['effective-access']) },
			setMembership: { mutationOptions: vi.fn() },
			create: { mutationOptions: vi.fn() },
			update: { mutationOptions: vi.fn() },
			delete: { mutationOptions: vi.fn() },
		},
	},
}));
vi.mock('@/components/settings/tool-call-density-slider', () => ({
	ToolCallDensitySlider: ({ onValueChange }: { onValueChange: (density: 'compact' | 'detailed') => void }) => (
		<button onClick={() => onValueChange('compact')}>Density slider</button>
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
vi.mock('@/components/settings/user-group-feature-card', () => ({
	UserGroupFeatureCard: ({
		feature,
		selected,
		onSelectedChange,
	}: {
		feature: { label: string };
		selected: boolean;
		onSelectedChange: (selected: boolean) => void;
	}) => <button onClick={() => onSelectedChange(!selected)}>{feature.label}</button>,
}));

const allUsers = {
	id: 'all-users',
	name: 'All Users',
	isDefault: true,
	featureGrants: [],
	toolCallDensityPolicy: DEFAULT_TOOL_CALL_DENSITY_POLICY,
	databaseAccess: { mode: 'all' as const, strict: true },
	docsAccess: ALL_DOCS_CONTEXT_ACCESS,
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
};

beforeEach(() => {
	mocks.mutateAsync.mockReset();
	mocks.useLicenseFeatures.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { 'user-groups': true },
	});
	mocks.useQuery.mockReturnValue({ isLoading: false, isError: false, data: overview });
	mocks.useMutation.mockReturnValue({
		mutate: vi.fn(),
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

	it('renders context and security panels', () => {
		const { rerender } = renderEditor('context');
		expect(screen.getByText('Context permissions')).toBeTruthy();

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
		expect(screen.getByText('Row-level security will be configured here.')).toBeTruthy();
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
		{ tab: 'features' as const, control: 'Stories' },
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
