// @vitest-environment jsdom

import {
	ALL_DOCS_CONTEXT_ACCESS,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_PROJECT_ROW_SECURITY,
	EMPTY_USER_GROUP_SSO_MAPPINGS,
} from '@nao/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	ConditionalRulesHelp,
	hasUserGroupEditorChanges,
	invalidateUserGroupQueries,
	UserGroupEditor,
} from './user-group-editor';
import { UserGroupEffectiveContext } from './user-group-effective-context';
import { UserGroupUserDetail } from './user-group-user-detail';
import { resolveUserGroupsPageTab, UserGroupsTable } from './user-groups-table';
import type { UserGroupEditorGroup, UserGroupEditorTab } from './user-group-editor';
import type { UserGroupUserDetailTab } from './user-group-user-detail';
import type { ComponentProps, MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	useLicenseFeatures: vi.fn(),
	useQuery: vi.fn(),
	useMutation: vi.fn(),
	invalidateQueries: vi.fn(),
	mutate: vi.fn(),
	mutateAsync: vi.fn(),
	navigate: vi.fn(),
	copyText: vi.fn(),
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
		contextExplorer: {
			readFile: { queryOptions: vi.fn(() => ({ queryKey: ['rules-file'] })) },
		},
		project: {
			getDatabaseObjects: { queryKey: vi.fn(() => ['database-objects']) },
		},
		userGroup: {
			overview: { queryOptions: vi.fn(), queryKey: vi.fn(() => ['overview']) },
			contextCatalog: { queryOptions: vi.fn(() => ({ queryKey: ['context-catalog'] })) },
			docsContextCatalog: { queryOptions: vi.fn(() => ({ queryKey: ['docs-context-catalog'] })) },
			rowSecurity: {
				queryOptions: vi.fn(() => ({ queryKey: ['row-security'] })),
				queryKey: vi.fn(() => ['row-security']),
			},
			updateRowSecurity: { mutationOptions: vi.fn() },
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
			<button
				onClick={() =>
					onDatabaseAccessChange({
						mode: 'restricted',
						strict: databaseAccess.strict,
						grants: [],
						patterns: [],
					})
				}
			>
				Remove Context permissions
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
	groupDatabaseContextObjects: (
		objects: Array<{ databaseType: string; database: string; schema: string; table: string; columns?: string[] }>,
	) => {
		const databases = new Map<
			string,
			{
				kind: 'database';
				key: string;
				databaseType: string;
				database: string;
				schemas: Map<
					string,
					{
						kind: 'schema';
						key: string;
						databaseType: string;
						database: string;
						schema: string;
						tables: typeof objects;
					}
				>;
			}
		>();
		for (const object of objects) {
			const databaseKey = `${object.databaseType}\0${object.database}`;
			const database = databases.get(databaseKey) ?? {
				kind: 'database' as const,
				key: databaseKey,
				databaseType: object.databaseType,
				database: object.database,
				schemas: new Map(),
			};
			const schemaKey = `${databaseKey}\0${object.schema}`;
			const schema = database.schemas.get(schemaKey) ?? {
				kind: 'schema' as const,
				key: schemaKey,
				databaseType: object.databaseType,
				database: object.database,
				schema: object.schema,
				tables: [],
			};
			schema.tables.push(object);
			database.schemas.set(schemaKey, schema);
			databases.set(databaseKey, database);
		}
		return [...databases.values()].map((database) => ({
			...database,
			schemas: [...database.schemas.values()],
		}));
	},
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
const rowSecurityIdentity = {
	databaseType: 'duckdb',
	database: 'sales',
	schema: 'main',
	table: 'orders',
};
const rowSecurityTable = {
	...rowSecurityIdentity,
	constraintColumns: ['tenant_id'],
};
const orderDatabaseAccess = {
	mode: 'restricted' as const,
	strict: true,
	grants: [{ kind: 'table' as const, ...rowSecurityIdentity }],
	patterns: [],
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
	mocks.copyText.mockReset().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: mocks.copyText },
	});
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
					: options?.queryKey?.[0] === 'row-security'
						? { version: 1, tables: [] }
						: options?.queryKey?.[0] === 'rules-file'
							? { content: '', hash: 'rules-hash' }
							: options?.queryKey?.[0] === 'context-catalog'
								? { syncState: 'ready', objects: [] }
								: options?.queryKey?.[0] === 'docs-context-catalog'
									? { syncState: 'ready', entries: [] }
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
	Object.defineProperty(Element.prototype, 'scrollIntoView', {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('UserGroupsTable', () => {
	it.each([
		{ isLoading: true, isError: false, actionName: 'Loading group access...' },
		{ isLoading: false, isError: true, actionName: 'Create group unavailable' },
	])('keeps groups visible but blocks creation while license resolution is unavailable', (licenseState) => {
		mocks.useLicenseFeatures.mockReturnValue({ ...licenseState, data: undefined });
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

		expect(screen.getByRole('row', { name: /All Users/ })).toBeTruthy();
		expect(screen.getByRole('row', { name: /Analysts/ })).toBeTruthy();
		expect((screen.getByRole('button', { name: licenseState.actionName }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.queryByText('Enterprise')).toBeNull();
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
		expect(screen.getByText('Group access')).toBeTruthy();
		expect(
			screen.getByText('Configure the features, database tables, and docs each group can access.'),
		).toBeTruthy();
		expect(screen.getByText('No features · All tables · Strict · All docs')).toBeTruthy();
		expect(screen.getByText('No features · No tables · Not strict · No docs')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Create group' })).toBeTruthy();
	});

	it('configures project constraint columns when RLS is licensed', () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { 'user-groups': true, 'row-level-security': true },
		});
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data:
				options?.queryKey?.[0] === 'context-catalog'
					? {
							syncState: 'ready',
							objects: [
								{
									databaseType: 'duckdb',
									database: 'sales',
									schema: 'main',
									table: 'orders',
									columns: ['tenant_id', 'total'],
								},
							],
						}
					: options?.queryKey?.[0] === 'docs-context-catalog'
						? { syncState: 'ready', entries: [] }
						: options?.queryKey?.[0] === 'row-security'
							? { version: 1, tables: [] }
							: overview,
		}));

		render(<UserGroupsTable tab='security' onTabChange={vi.fn()} />);
		fireEvent.click(screen.getAllByRole('button', { name: 'Add protected table' })[0]);
		fireEvent.click(screen.getByRole('button', { name: 'Expand sales database' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutate).toHaveBeenCalledWith(
			{
				version: 1,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'sales',
						schema: 'main',
						table: 'orders',
						constraintColumns: ['tenant_id'],
					},
				],
			},
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
	});

	it('shows catalog states in group summaries and retries errors', () => {
		const retryTables = vi.fn();
		const retryDocs = vi.fn();
		mocks.useQuery
			.mockReturnValueOnce({ isLoading: false, isError: false, data: overview })
			.mockReturnValueOnce({ isLoading: true, isError: false, data: undefined, refetch: retryTables })
			.mockReturnValueOnce({ isLoading: false, isError: true, data: undefined, refetch: retryDocs });

		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		expect(screen.getAllByText(/Loading tables/)).toHaveLength(2);
		expect(screen.getAllByText(/Docs unavailable/)).toHaveLength(2);
		expect(screen.queryByText(/No tables/)).toBeNull();
		expect(screen.queryByText(/No docs/)).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Retry docs for Analysts' }));
		expect(retryDocs).toHaveBeenCalledOnce();
		expect(retryTables).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it('keeps the users table available when catalogs fail', () => {
		mocks.useQuery
			.mockReturnValueOnce({ isLoading: false, isError: false, data: overview })
			.mockReturnValueOnce({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() })
			.mockReturnValueOnce({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() });

		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		expect(screen.getByText('Project User')).toBeTruthy();
		expect(screen.getByText('Organisation User')).toBeTruthy();
		expect(screen.queryByText(/unavailable/i)).toBeNull();
	});

	it('orders active groups by name before locked groups without mutating query data', () => {
		const groups = [
			{ id: 'aardvark', name: 'Aardvark', isDefault: false, isLocked: true as const },
			{ ...analysts, id: 'zulu', name: 'Zulu' },
			allUsers,
			{ id: 'beta', name: 'Beta', isDefault: false, isLocked: true as const },
			analysts,
		];
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { ...overview, groups },
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		const expectedNames = ['All Users', 'Analysts', 'Zulu', 'Aardvark', 'Beta'];
		const renderedNames = screen
			.getAllByRole('row')
			.slice(1)
			.map((row) => expectedNames.find((name) => row.textContent?.includes(name)));

		expect(renderedNames).toEqual(expectedNames);
		expect(groups.map((group) => group.id)).toEqual(['aardvark', 'zulu', 'all-users', 'beta', 'analysts']);
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

	it('shows locked groups without navigation or active access details', async () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				...overview,
				groups: [allUsers, analysts, { id: 'archived', name: 'Archived', isDefault: false, isLocked: true }],
			},
		});
		render(<UserGroupsTable tab='groups' onTabChange={vi.fn()} />);

		const lockedRow = screen.getByRole('row', { name: /Archived/ });
		expect(lockedRow.className).not.toContain('cursor-pointer');
		expect(screen.queryByRole('link', { name: 'Archived' })).toBeNull();
		expect(lockedRow.textContent).toContain('Inactive');
		expect(lockedRow.textContent).toContain('Locked');

		fireEvent.click(lockedRow);
		expect(mocks.navigate).not.toHaveBeenCalled();
		const upgradeTrigger = screen.getByRole('button', { name: 'Archived requires Enterprise' });
		expect(upgradeTrigger.className).toContain('cursor-pointer');
		fireEvent.click(upgradeTrigger);
		expect(
			await screen.findByText('The free plan allows only 3 custom groups. Upgrade to Enterprise to have more.'),
		).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Upgrade to Enterprise' })).toBeTruthy();
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

		const createGroupButton = screen.getByRole('button', { name: 'Create group' });
		expect(createGroupButton.classList.contains('w-72')).toBe(true);
		fireEvent.click(createGroupButton);

		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(
			await screen.findByText('The free plan allows only 3 custom groups. Upgrade to Enterprise to create more.'),
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

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
			'Users',
			'Manage Groups',
			'Security',
		]);
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

	it('omits locked groups from user chips and assignment menus', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				...overview,
				groups: [allUsers, analysts, { id: 'archived', name: 'Archived', isDefault: false, isLocked: true }],
				memberships: [...overview.memberships, { groupId: 'archived', userId: 'project-user' }],
			},
		});
		render(<UserGroupsTable tab='users' onTabChange={vi.fn()} />);

		expect(
			screen.getByRole('button', { name: /Manage groups for Project User/ }).getAttribute('aria-label'),
		).not.toContain('Archived');
		fireEvent.pointerDown(screen.getByRole('button', { name: /Manage groups for Project User/ }), {
			button: 0,
			ctrlKey: false,
		});
		expect(screen.queryByRole('menuitemcheckbox', { name: 'Archived' })).toBeNull();
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
		expect(resolveUserGroupsPageTab('security')).toBe('security');
	});
});

describe('ConditionalRulesHelp', () => {
	it('shows only effective matching rules from RULES.md', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: {
				content: [
					'Global rule',
					'{% if group("analysts", "finance") %}',
					'Analyst-specific rule',
					'{% if group("finance") %}',
					'Finance-only nested rule',
					'{% endif %}',
					'{% endif %}',
					'{% if group("marketing") %}',
					'Marketing-only rule',
					'{% endif %}',
					'Global ending',
				].join('\n'),
			},
		});

		render(<ConditionalRulesHelp groupName='Analysts' />);

		expect(screen.getByText('This group has specific rules in RULES.md.')).toBeTruthy();
		const code = screen.getByText((_content, element) => element?.tagName === 'CODE');
		expect(code.textContent).toBe('Analyst-specific rule\n');
		expect(code.textContent).not.toContain('{% if');
		expect(code.textContent).not.toContain('{% endif %}');
		expect(code.textContent).not.toContain('Global rule');
		expect(code.textContent).not.toContain('Finance-only nested rule');
		expect(code.textContent).not.toContain('Marketing-only rule');
	});

	it('shows a wrapping example for a group without matching rules and copies it', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: false,
			data: { content: '{% if group("marketing") %}\nMarketing only\n{% endif %}\n' },
		});

		render(<ConditionalRulesHelp groupName='Analysts' />);

		expect(screen.getByText('Add a conditional block to RULES.md to give this group specific rules.')).toBeTruthy();
		const code = screen.getByText((_content, element) => element?.tagName === 'CODE');
		const expectedSnippet = '{% if group("Analysts") %}\nGroup-specific instructions...\n{% endif %}';
		expect(code.textContent).toBe(expectedSnippet);
		const pre = code.closest('pre');
		expect(pre?.classList.contains('whitespace-pre-wrap')).toBe(true);
		expect(pre?.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
		expect(pre?.classList.contains('overflow-x-auto')).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'Copy conditional rules snippet' }));
		expect(mocks.copyText).toHaveBeenCalledWith(expectedSnippet);
		expect(screen.queryByText('Open File Explorer')).toBeNull();
	});

	it('prompts for a group name without flashing the loading state', () => {
		mocks.useQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });

		render(<ConditionalRulesHelp groupName='  ' />);

		expect(screen.getByText('Enter a group name to generate a snippet.')).toBeTruthy();
		expect(screen.queryByText('Loading RULES.md...')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Copy conditional rules snippet' })).toBeNull();
	});

	it('shows a compact loading state', () => {
		mocks.useQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });

		render(<ConditionalRulesHelp groupName='Analysts' />);

		expect(screen.getByText('Loading RULES.md...')).toBeTruthy();
		expect(screen.queryByText(/Group-specific instructions/)).toBeNull();
	});

	it('falls back to the example when RULES.md cannot be read', () => {
		mocks.useQuery.mockReturnValue({ isLoading: false, isError: true, data: undefined });

		render(<ConditionalRulesHelp groupName='Analysts' />);

		expect(screen.getByText(/Group-specific instructions/)).toBeTruthy();
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

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Features', 'Context', 'Security']);
		expect(screen.getByRole('tab', { name: 'Features' }).getAttribute('aria-selected')).toBe('true');
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

	it('shows Conditional Rules in Context and locked RLS controls in Security', () => {
		const { rerender } = renderEditor('context');
		expect(screen.getByText('Context permissions')).toBeTruthy();
		const heading = screen.getByRole('heading', { name: 'Conditional Rules' });
		expect(heading).toBeTruthy();
		expect(heading.closest('section')?.classList.contains('border-t')).toBe(true);

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
		expect(screen.queryByRole('heading', { name: 'Conditional Rules' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Row-level security' })).toBeTruthy();
		expect(screen.getByText('No sensitive tables are configured in the project Security tab.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Upgrade to Enterprise' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: /SSO group mapping/ })).toBeNull();
	});

	it('removes the Enterprise RLS marker when row-level security is licensed', () => {
		enableRowLevelSecurity();
		renderEditor('security', vi.fn(), { ...analysts, databaseAccess: orderDatabaseAccess });

		expect(screen.getByRole('heading', { name: 'Row-level security' })).toBeTruthy();
		expect(screen.getByText('Constraint columns: tenant_id')).toBeTruthy();
		expect(screen.getByRole('combobox', { name: 'Row access for orders' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Upgrade to Enterprise' })).toBeNull();
	});

	it('blocks incomplete Guided policies, switches to Security, and clears errors on cancel', () => {
		enableRowLevelSecurity();
		const group = {
			...analysts,
			databaseAccess: orderDatabaseAccess,
		};
		render(<StatefulEditorHarness group={group} initialTab='features' />);
		fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
		fireEvent.keyDown(screen.getByRole('combobox', { name: 'Row access for orders' }), { key: 'Enter' });
		fireEvent.click(screen.getByRole('option', { name: 'Filtered rows' }));
		fireEvent.click(screen.getByRole('tab', { name: 'Features' }));

		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutateAsync).not.toHaveBeenCalled();
		expect(screen.getByRole('tab', { name: 'Security' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('Enter a value.')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByText('Enter a value.')).toBeNull();
	});

	it('blocks incomplete SQL policies and reveals the field error', () => {
		enableRowLevelSecurity();
		renderEditor('security', vi.fn(), { ...analysts, databaseAccess: orderDatabaseAccess });
		fireEvent.keyDown(screen.getByRole('combobox', { name: 'Row access for orders' }), { key: 'Enter' });
		fireEvent.click(screen.getByRole('option', { name: 'Filtered rows' }));
		fireEvent.click(screen.getByRole('button', { name: 'SQL' }));

		expect(screen.queryByText('Enter a WHERE clause.')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutateAsync).not.toHaveBeenCalled();
		expect(screen.getByText('Enter a WHERE clause.')).toBeTruthy();
	});

	it('saves valid row policies', () => {
		enableRowLevelSecurity();
		const rowPolicies = {
			version: 1 as const,
			policies: [
				{
					...rowSecurityIdentity,
					access: 'predicate' as const,
					mode: 'guided' as const,
					combinator: 'and' as const,
					conditions: [{ column: 'tenant_id', operator: 'equals' as const, value: '7' }],
				},
			],
		};
		renderEditor('security', vi.fn(), { ...analysts, databaseAccess: orderDatabaseAccess, rowPolicies });
		fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), {
			target: { value: 'Updated analysts' },
		});

		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ rowPolicies }));
		expect(screen.queryByText('Enter a value.')).toBeNull();
	});

	it('filters inaccessible legacy policies before validation and reset', () => {
		enableRowLevelSecurity();
		const onTabChange = vi.fn();
		renderEditor('features', onTabChange, {
			...analysts,
			rowPolicies: {
				version: 1,
				policies: [
					{
						...rowSecurityIdentity,
						access: 'predicate',
						mode: 'sql',
						predicate: 'WHERE tenant_id = 7',
					},
				],
			},
		});
		const nameInput = screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement;

		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		fireEvent.change(nameInput, { target: { value: 'Changed analysts' } });
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(nameInput.value).toBe('Analysts');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

		fireEvent.change(nameInput, { target: { value: 'Updated analysts' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(onTabChange).not.toHaveBeenCalled();
		expect(mocks.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Updated analysts',
				rowPolicies: { version: 1, policies: [] },
			}),
		);
	});

	it('prunes draft row policies when Context permissions are removed', () => {
		enableRowLevelSecurity();
		const rowPolicies = {
			version: 1 as const,
			policies: [{ ...rowSecurityIdentity, access: 'full' as const }],
		};
		renderEditor('context', vi.fn(), {
			...analysts,
			databaseAccess: orderDatabaseAccess,
			rowPolicies,
		});

		fireEvent.click(screen.getByRole('button', { name: 'Remove Context permissions' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutateAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
				rowPolicies: { version: 1, policies: [] },
			}),
		);
	});

	it('shows SSO for configured OIDC without stored mappings and saves edits', () => {
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
		const { rerender } = renderEditor('security');
		expect(screen.getByRole('tab', { name: 'SSO' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'SSO group mapping — Okta' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Row-level security' })).toBeTruthy();
		rerender(
			<UserGroupEditor
				group={analysts}
				activeTab='sso'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

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

	it('shows SSO for configured Microsoft Entra without stored mappings and saves edits', () => {
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
		renderEditor('sso');
		expect(screen.getByRole('tab', { name: 'SSO' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'SSO group mapping — Okta' })).toBeNull();

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
		renderEditor('sso');

		expect(screen.getByRole('heading', { name: 'SSO group mapping — Okta' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'SSO group mapping — Microsoft Entra' })).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Okta group name' })).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Microsoft Entra group object ID' })).toBeTruthy();
	});

	it('does not expose stale OIDC mappings when provider configuration fails to resolve', () => {
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => {
			if (options?.queryKey?.[0] === 'oidc-config') {
				return { isLoading: false, isError: true, data: undefined };
			}
			if (options?.queryKey?.[0] === 'microsoft-config') {
				return { isLoading: false, isError: false, data: false };
			}
			return { isLoading: false, isError: false, data: overview };
		});
		const onTabChange = vi.fn();
		renderEditor('sso', onTabChange, {
			...analysts,
			ssoMappings: {
				version: 1,
				providers: { oidc: ['finance-team'], microsoft: [] },
			},
		});

		expect(screen.queryByRole('tab', { name: 'SSO' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'SSO group mapping — OIDC' })).toBeNull();
		expect(screen.queryByText('finance-team')).toBeNull();
		expect(screen.queryByRole('textbox', { name: 'OIDC group name' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove OIDC group finance-team' })).toBeNull();
		expect(onTabChange).toHaveBeenCalledWith('features');
	});

	it('does not expose stale SSO mappings when the license query fails', () => {
		mocks.useLicenseFeatures.mockReturnValue({
			isLoading: false,
			isError: true,
			data: undefined,
		});
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
			isLoading: false,
			isError: false,
			data: undefined,
		}));

		const onTabChange = vi.fn();
		renderEditor('sso', onTabChange, {
			...analysts,
			ssoMappings: {
				version: 1,
				providers: { oidc: ['finance-team'], microsoft: [] },
			},
		});

		expect(screen.queryByRole('tab', { name: 'SSO' })).toBeNull();
		expect(screen.queryByText('finance-team')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove OIDC group finance-team' })).toBeNull();
		expect(onTabChange).toHaveBeenCalledWith('features');
	});

	it('hides stale stored OIDC mappings when no SSO provider is configured', () => {
		const onTabChange = vi.fn();
		renderEditor('sso', onTabChange, {
			...analysts,
			ssoMappings: {
				version: 1,
				providers: { oidc: ['former-provider-group'], microsoft: [] },
			},
		});

		expect(screen.queryByRole('tab', { name: 'SSO' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'SSO group mapping — OIDC' })).toBeNull();
		expect(screen.queryByText('former-provider-group')).toBeNull();
		expect(screen.queryByRole('textbox', { name: 'OIDC group name' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove OIDC group former-provider-group' })).toBeNull();
		expect(onTabChange).toHaveBeenCalledWith('features');
	});

	it('resets an unsaved mapping draft when switching groups', () => {
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
		const { rerender } = renderEditor('sso');
		fireEvent.change(screen.getByRole('textbox', { name: 'Okta group name' }), {
			target: { value: 'analysts-draft' },
		});

		rerender(
			<UserGroupEditor
				group={{ ...analysts, id: 'finance', name: 'Finance' }}
				activeTab='sso'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect((screen.getByRole('textbox', { name: 'Okta group name' }) as HTMLInputElement).value).toBe('');
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
		renderEditor('sso', vi.fn(), allUsers);
		expect(screen.getByText(/All Users already includes everyone/)).toBeTruthy();
		expect(screen.queryByRole('textbox', { name: 'Okta group name' })).toBeNull();
	});

	it('falls back from SSO after provider queries finish without a configured provider', () => {
		let configsLoading = true;
		const groupWithStaleMapping = {
			...analysts,
			ssoMappings: {
				version: 1 as const,
				providers: { oidc: ['finance-team'], microsoft: [] },
			},
		};
		mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => {
			const queryKey = options?.queryKey?.[0];
			const isConfigQuery = queryKey === 'oidc-config' || queryKey === 'microsoft-config';
			return {
				isLoading: isConfigQuery && configsLoading,
				isError: false,
				data:
					queryKey === 'oidc-config'
						? null
						: queryKey === 'microsoft-config'
							? false
							: queryKey === 'row-security'
								? { version: 1, tables: [] }
								: overview,
			};
		});
		const onTabChange = vi.fn();
		const { rerender } = renderEditor('sso', onTabChange, groupWithStaleMapping);

		expect(screen.queryByRole('tab', { name: 'SSO' })).toBeNull();
		expect(screen.getByText('Loading SSO configuration...')).toBeTruthy();
		expect(screen.queryByText('finance-team')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove OIDC group finance-team' })).toBeNull();
		expect(onTabChange).not.toHaveBeenCalled();
		configsLoading = false;
		rerender(
			<UserGroupEditor
				group={groupWithStaleMapping}
				activeTab='sso'
				onTabChange={onTabChange}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect(screen.queryByText('Loading SSO configuration...')).toBeNull();
		expect(screen.queryByText('finance-team')).toBeNull();
		expect(onTabChange).toHaveBeenCalledWith('features');
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

	it('preserves dirty drafts across same-group refetches and resets when switching groups', () => {
		const initialGroup = {
			...analysts,
			createdAt: new Date('2026-09-01T00:00:00Z'),
			updatedAt: new Date('2026-09-01T00:00:00Z'),
		};
		const { rerender } = renderEditor('features', vi.fn(), initialGroup);
		const nameInput = screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement;

		fireEvent.change(nameInput, { target: { value: 'Draft analysts' } });
		const refreshedGroup = {
			...initialGroup,
			createdAt: new Date(initialGroup.createdAt),
			updatedAt: new Date(initialGroup.updatedAt),
		};
		rerender(
			<UserGroupEditor
				group={refreshedGroup}
				activeTab='features'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect(nameInput.value).toBe('Draft analysts');
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

		rerender(
			<UserGroupEditor
				group={{ ...analysts, id: 'finance', name: 'Finance' }}
				activeTab='features'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect(nameInput.value).toBe('Finance');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('synchronizes same-group server updates while the form is clean', () => {
		const { rerender } = renderEditor();

		rerender(
			<UserGroupEditor
				group={{ ...analysts, name: 'Data Analysts' }}
				activeTab='features'
				onTabChange={vi.fn()}
				onCancelNew={vi.fn()}
				onCreated={vi.fn()}
				onDeleted={vi.fn()}
			/>,
		);

		expect((screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement).value).toBe('Data Analysts');
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

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Features', 'Context', 'Security']);
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
				rowPolicies: [],
			},
		});

		expect(screen.getByText('2 features · 2 tables · 2 docs · Not strict')).toBeTruthy();
		expect(screen.queryByText(/All tables|All docs/)).toBeNull();
	});

	it('hides the access summary when context is not synced', () => {
		renderUserDetail({
			activeTab: 'context',
			databaseSyncState: 'missing',
			docsSyncState: 'missing',
		});

		expect(screen.getAllByText('Not synced')).toHaveLength(2);
		expect(screen.queryByText('1 feature · 0 tables · 0 docs · Strict')).toBeNull();
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
				rowPolicies: [],
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
				rowPolicies: [],
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

	it('shows OR-combined effective SQL from guided and SQL policies', () => {
		enableRowLevelSecurity();
		renderUserDetail({
			activeTab: 'security',
			projectRowSecurity: { version: 1, tables: [rowSecurityTable] },
			effectiveAccess: createEffectiveAccess([
				{
					version: 1,
					policies: [
						{
							...rowSecurityIdentity,
							access: 'predicate',
							mode: 'guided',
							combinator: 'and',
							conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
						},
					],
				},
				{
					version: 1,
					policies: [
						{
							...rowSecurityIdentity,
							access: 'predicate',
							mode: 'sql',
							predicate: "WHERE region = 'emea'",
						},
					],
				},
			]),
		});

		expect(screen.getByText('sales/main/orders')).toBeTruthy();
		expect(screen.getByText('Filtered')).toBeTruthy();
		const sql = screen.getByText(/"tenant_id" = 7/).textContent ?? '';
		expect(sql).toContain('WHERE');
		expect(sql).toContain(' OR ');
		expect(sql).toContain("(region = 'emea')");
	});

	it('shows full access when any applicable policy grants it', () => {
		enableRowLevelSecurity();
		renderUserDetail({
			activeTab: 'security',
			projectRowSecurity: { version: 1, tables: [rowSecurityTable] },
			effectiveAccess: createEffectiveAccess([
				{
					version: 1,
					policies: [
						{
							...rowSecurityIdentity,
							access: 'predicate',
							mode: 'sql',
							predicate: 'WHERE tenant_id = 7',
						},
					],
				},
				{ version: 1, policies: [{ ...rowSecurityIdentity, access: 'full' }] },
			]),
		});

		expect(screen.getByText('Full access')).toBeTruthy();
		expect(screen.queryByText('No WHERE clause — full row access.')).toBeNull();
		expect(screen.queryByText(/^WHERE/)).toBeNull();
		expect(screen.queryByText(/tenant_id = 7/)).toBeNull();
	});

	it('shows no rows when no applicable policy matches', () => {
		enableRowLevelSecurity();
		renderUserDetail({
			activeTab: 'security',
			projectRowSecurity: { version: 1, tables: [rowSecurityTable] },
			effectiveAccess: createEffectiveAccess([]),
		});

		const noRowsBadge = screen.getByText('No rows');
		expect(noRowsBadge.classList.contains('bg-accent')).toBe(true);
		expect(noRowsBadge.classList.contains('text-accent-foreground')).toBe(true);
		expect(noRowsBadge.classList.contains('bg-destructive')).toBe(false);
		expect(screen.queryByText('WHERE FALSE')).toBeNull();
	});

	it('shows an empty state when no protected tables are configured', () => {
		enableRowLevelSecurity();
		renderUserDetail({ activeTab: 'security' });

		expect(screen.getByText('No protected tables configured.')).toBeTruthy();
	});

	it('omits protected tables unavailable through effective Context permissions', () => {
		enableRowLevelSecurity();
		renderUserDetail({
			activeTab: 'security',
			projectRowSecurity: { version: 1, tables: [rowSecurityTable] },
			effectiveAccess: {
				...createEffectiveAccess([{ version: 1, policies: [{ ...rowSecurityIdentity, access: 'full' }] }]),
				databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			},
		});

		expect(
			screen.getByText("No protected tables are available through this user's Context permissions."),
		).toBeTruthy();
		expect(screen.queryByText('sales/main/orders')).toBeNull();
		expect(screen.queryByText('Full access')).toBeNull();
	});

	it('does not show filters as active when row-level security is unlicensed', () => {
		renderUserDetail({
			activeTab: 'security',
			projectRowSecurity: { version: 1, tables: [rowSecurityTable] },
			effectiveAccess: createEffectiveAccess([
				{
					version: 1,
					policies: [
						{
							...rowSecurityIdentity,
							access: 'predicate',
							mode: 'sql',
							predicate: 'WHERE tenant_id = 7',
						},
					],
				},
			]),
		});

		expect(screen.getByText('Enterprise feature inactive')).toBeTruthy();
		expect(screen.getByText('No row filters are currently enforced.')).toBeTruthy();
		expect(screen.queryByText('Filtered')).toBeNull();
		expect(screen.queryByText(/tenant_id = 7/)).toBeNull();
	});

	it('shows row-security loading and error states with retry', () => {
		enableRowLevelSecurity();
		const retry = vi.fn();
		const { rerender } = renderUserDetail({
			activeTab: 'security',
			securityState: 'loading',
			onRetrySecurity: retry,
		});
		expect(screen.getByText('Loading row-level security...')).toBeTruthy();

		rerender(
			createUserDetail('security', {
				securityState: 'error',
				onRetrySecurity: retry,
			}),
		);
		expect(screen.getByText('Failed to load row-level security')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it('keeps non-context tabs available while catalogs load or fail', () => {
		renderUserDetail({
			databaseCatalogState: 'loading',
			docsCatalogState: 'error',
		});

		expect(screen.getByRole('heading', { name: 'Allowed features' })).toBeTruthy();
		expect(screen.queryByText(/Loading tables/)).toBeNull();
		expect(screen.queryByText(/Docs unavailable/)).toBeNull();
	});

	it('shows catalog states and retries only in the context tab', () => {
		const retryDatabase = vi.fn();
		const retryDocs = vi.fn();
		renderUserDetail({
			activeTab: 'context',
			databaseCatalogState: 'error',
			docsCatalogState: 'error',
			onRetryDatabaseCatalog: retryDatabase,
			onRetryDocsCatalog: retryDocs,
		});

		fireEvent.click(screen.getByRole('button', { name: 'Retry database tables' }));
		fireEvent.click(screen.getByRole('button', { name: 'Retry docs' }));

		expect(retryDatabase).toHaveBeenCalledOnce();
		expect(retryDocs).toHaveBeenCalledOnce();
		expect(screen.queryByText('1 feature · 0 tables · 0 docs · Strict')).toBeNull();
	});
});

function enableRowLevelSecurity() {
	mocks.useLicenseFeatures.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { 'user-groups': true, 'row-level-security': true },
	});
	mocks.useQuery.mockImplementation((options?: { queryKey?: string[] }) => ({
		isLoading: false,
		isError: false,
		data:
			options?.queryKey?.[0] === 'row-security'
				? { version: 1, tables: [rowSecurityTable] }
				: options?.queryKey?.[0] === 'oidc-config'
					? null
					: options?.queryKey?.[0] === 'microsoft-config'
						? false
						: overview,
	}));
}

function StatefulEditorHarness({ group, initialTab }: { group: UserGroupEditorGroup; initialTab: UserGroupEditorTab }) {
	const [activeTab, setActiveTab] = useState(initialTab);
	return (
		<UserGroupEditor
			group={group}
			activeTab={activeTab}
			onTabChange={setActiveTab}
			onCancelNew={vi.fn()}
			onCreated={vi.fn()}
			onDeleted={vi.fn()}
		/>
	);
}

function renderEditor(
	activeTab: UserGroupEditorTab = 'features',
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
	databaseSyncState = 'ready',
	docsSyncState = 'ready',
	databaseCatalogState = 'ready',
	docsCatalogState = 'ready',
	onRetryDatabaseCatalog,
	onRetryDocsCatalog,
	projectRowSecurity = EMPTY_PROJECT_ROW_SECURITY,
	securityState = 'ready',
	onRetrySecurity,
	effectiveAccess = {
		features: { 'story-creation': true, 'automation-creation': false },
		toolCallDensityPolicy: { defaultDensity: 'compact', canChange: true },
		databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
		docsAccess: { mode: 'restricted', grants: [] },
		rowPolicies: [],
	},
}: {
	groups?: UserGroupEditorGroup[];
	activeTab?: UserGroupUserDetailTab;
	contextObjects?: Array<{ databaseType: string; database: string; schema: string; table: string }>;
	docsEntries?: Array<{ kind: 'folder' | 'file'; path: string }>;
	databaseSyncState?: 'missing' | 'ready';
	docsSyncState?: 'missing' | 'ready';
	databaseCatalogState?: 'loading' | 'error' | 'ready';
	docsCatalogState?: 'loading' | 'error' | 'ready';
	onRetryDatabaseCatalog?: () => void;
	onRetryDocsCatalog?: () => void;
	projectRowSecurity?: ComponentProps<typeof UserGroupUserDetail>['projectRowSecurity'];
	securityState?: ComponentProps<typeof UserGroupUserDetail>['securityState'];
	onRetrySecurity?: () => void;
	effectiveAccess?: ComponentProps<typeof UserGroupUserDetail>['effectiveAccess'];
} = {}) {
	return render(
		createUserDetail(activeTab, {
			groups,
			contextObjects,
			docsEntries,
			effectiveAccess,
			databaseSyncState,
			docsSyncState,
			databaseCatalogState,
			docsCatalogState,
			onRetryDatabaseCatalog,
			onRetryDocsCatalog,
			projectRowSecurity,
			securityState,
			onRetrySecurity,
		}),
	);
}

function createUserDetail(
	activeTab: UserGroupUserDetailTab,
	props: Partial<ComponentProps<typeof UserGroupUserDetail>> = {},
) {
	const effectiveAccess = props.effectiveAccess ?? createEffectiveAccess([]);
	return (
		<UserGroupUserDetail
			user={{ ...overview.users[0], role: 'user', status: 'active' }}
			groups={props.groups ?? [allUsers, analysts]}
			memberships={overview.memberships}
			effectiveAccess={effectiveAccess}
			contextObjects={props.contextObjects ?? []}
			docsEntries={props.docsEntries ?? []}
			databaseSyncState={props.databaseSyncState ?? 'ready'}
			docsSyncState={props.docsSyncState ?? 'ready'}
			databaseCatalogState={props.databaseCatalogState ?? 'ready'}
			docsCatalogState={props.docsCatalogState ?? 'ready'}
			onRetryDatabaseCatalog={props.onRetryDatabaseCatalog}
			onRetryDocsCatalog={props.onRetryDocsCatalog}
			projectRowSecurity={props.projectRowSecurity ?? EMPTY_PROJECT_ROW_SECURITY}
			securityState={props.securityState ?? 'ready'}
			onRetrySecurity={props.onRetrySecurity}
			activeTab={activeTab}
			onTabChange={vi.fn()}
		/>
	);
}

function createEffectiveAccess(
	rowPolicies: ComponentProps<typeof UserGroupUserDetail>['effectiveAccess']['rowPolicies'],
): ComponentProps<typeof UserGroupUserDetail>['effectiveAccess'] {
	return {
		features: { 'story-creation': true, 'automation-creation': false },
		toolCallDensityPolicy: { defaultDensity: 'compact', canChange: true },
		databaseAccess: { mode: 'all', strict: true },
		docsAccess: { mode: 'restricted', grants: [] },
		rowPolicies,
	};
}
