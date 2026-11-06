// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ProjectColumnSecurity } from './project-column-security';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	mutate: vi.fn(),
	onMutationSuccess: undefined as undefined | (() => Promise<void>),
	securityData: { version: 1, tables: [] } as {
		version: 1;
		tables: Array<{
			databaseType: string;
			database: string;
			schema: string;
			table: string;
			restrictedColumns: string[];
		}>;
	},
}));

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: { 'row-level-security': true } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		userGroup: {
			columnSecurity: {
				queryKey: () => ['column-security'],
				queryOptions: () => ({ queryKey: ['column-security'] }),
			},
			effectiveAccess: {
				queryKey: () => ['effective-access'],
			},
			effectiveAccessForUser: {
				queryKey: () => ['effective-access-for-user'],
			},
			overview: {
				queryKey: () => ['overview'],
			},
			updateColumnSecurity: {
				mutationOptions: (options: unknown) => options,
			},
		},
	},
}));
vi.mock('@tanstack/react-query', () => ({
	useMutation: (options: { onSuccess: () => Promise<void> }) => {
		mocks.onMutationSuccess = options.onSuccess;
		return { mutate: mocks.mutate, isPending: false, error: null };
	},
	useQuery: () => ({ data: mocks.securityData, isLoading: false, isError: false }),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

beforeEach(() => {
	mocks.invalidateQueries.mockReset();
	mocks.invalidateQueries.mockResolvedValue(undefined);
	mocks.mutate.mockReset();
	mocks.onMutationSuccess = undefined;
	mocks.securityData = { version: 1, tables: [] };
});

afterEach(cleanup);

it('invalidates column and group access queries after saving', async () => {
	render(<ProjectColumnSecurity objects={[]} />);

	await mocks.onMutationSuccess?.();

	expect(mocks.invalidateQueries.mock.calls).toEqual([
		[{ queryKey: ['column-security'] }],
		[{ queryKey: ['overview'] }],
		[{ queryKey: ['effective-access'] }],
		[{ queryKey: ['effective-access-for-user'] }],
	]);
});

it('saves a newly hidden column without hiding other columns', () => {
	render(
		<ProjectColumnSecurity
			objects={[
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					columns: ['email', 'id'],
				},
			]}
		/>,
	);

	fireEvent.click(screen.getAllByRole('button', { name: 'Mark sensitive fields' })[0]);
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand public schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand users table columns' }));
	fireEvent.click(screen.getByRole('checkbox', { name: 'Hide email on users' }));
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	expect(mocks.mutate).toHaveBeenCalledWith(
		{
			version: 1,
			tables: [
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					restrictedColumns: ['email'],
				},
			],
			expectedCurrent: { version: 1, tables: [] },
		},
		expect.objectContaining({ onSuccess: expect.any(Function) }),
	);
});

it('sends the opening registry revision when saving the add dialog', () => {
	const objects = [
		{
			databaseType: 'postgres',
			database: 'analytics',
			schema: 'public',
			table: 'users',
			columns: ['email'],
		},
		{
			databaseType: 'postgres',
			database: 'analytics',
			schema: 'public',
			table: 'orders',
			columns: ['cost'],
		},
	];
	const { rerender } = render(<ProjectColumnSecurity objects={objects} />);
	fireEvent.click(screen.getAllByRole('button', { name: 'Mark sensitive fields' })[0]);
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand public schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand users table columns' }));
	fireEvent.click(screen.getByRole('checkbox', { name: 'Hide email on users' }));

	mocks.securityData = {
		version: 1,
		tables: [
			{
				databaseType: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'orders',
				restrictedColumns: ['cost'],
			},
		],
	};
	rerender(<ProjectColumnSecurity objects={objects} />);
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));

	expect(mocks.mutate).toHaveBeenCalledWith(
		{
			version: 1,
			tables: [
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					restrictedColumns: ['email'],
				},
			],
			expectedCurrent: { version: 1, tables: [] },
		},
		expect.objectContaining({ onSuccess: expect.any(Function) }),
	);
});

it('lets users collapse nodes auto-expanded by search', () => {
	render(
		<ProjectColumnSecurity
			objects={[
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					columns: ['email'],
				},
			]}
		/>,
	);
	fireEvent.click(screen.getAllByRole('button', { name: 'Mark sensitive fields' })[0]);
	fireEvent.change(screen.getByRole('textbox', { name: 'Search sensitive fields' }), {
		target: { value: 'email' },
	});

	fireEvent.click(screen.getByRole('button', { name: 'Collapse users table columns' }));
	expect(screen.getByRole('button', { name: 'Expand users table columns' })).toBeTruthy();
	expect(screen.queryByRole('checkbox', { name: 'Hide email on users' })).toBeNull();
});

it('allows stale registered fields to be unchecked in the add dialog', () => {
	mocks.securityData = {
		version: 1,
		tables: [
			{
				databaseType: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'users',
				restrictedColumns: ['legacy_email'],
			},
		],
	};
	render(
		<ProjectColumnSecurity
			objects={[
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					columns: ['email'],
				},
			]}
		/>,
	);
	fireEvent.click(screen.getByRole('button', { name: 'Mark sensitive fields' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand public schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand users table columns' }));

	const staleField = screen.getByRole('checkbox', { name: 'Hide legacy_email on users' });
	expect(staleField.getAttribute('data-state')).toBe('checked');
	fireEvent.click(staleField);
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	expect(mocks.mutate).toHaveBeenCalledWith(
		{
			version: 1,
			tables: [],
			expectedCurrent: {
				version: 1,
				tables: [
					{
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'users',
						restrictedColumns: ['legacy_email'],
					},
				],
			},
		},
		expect.objectContaining({ onSuccess: expect.any(Function) }),
	);
});

it('does not mark registered tables unavailable before the catalog is ready', () => {
	mocks.securityData = {
		version: 1,
		tables: [
			{
				databaseType: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'users',
				restrictedColumns: ['email'],
			},
		],
	};

	render(<ProjectColumnSecurity objects={[]} catalogState='loading' />);

	expect(screen.queryByText('Unavailable')).toBeNull();
	expect(screen.getByText('Loading synced tables...')).toBeTruthy();
});
