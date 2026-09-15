// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectRowSecurity } from './project-row-security';

const mocks = vi.hoisted(() => ({
	rowSecurity: { version: 1, tables: [] } as {
		version: 1;
		tables: Array<{
			databaseType: string;
			database: string;
			schema: string;
			table: string;
			constraintColumns: string[];
		}>;
	},
	licensed: true,
	queryLoading: false,
	queryError: false,
	mutationPending: false,
	mutationError: null as Error | null,
	mutate: vi.fn(),
	mutationOptions: vi.fn(),
	invalidateQueries: vi.fn(),
	refetch: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: mocks.rowSecurity,
		isLoading: mocks.queryLoading,
		isError: mocks.queryError,
		refetch: mocks.refetch,
	}),
	useMutation: (options?: {
		onSuccess?: (...args: unknown[]) => unknown;
		onSettled?: (...args: unknown[]) => unknown;
	}) => ({
		mutate: (
			variables: unknown,
			callOptions?: {
				onSuccess?: (...args: unknown[]) => unknown;
				onSettled?: (...args: unknown[]) => unknown;
			},
		) => {
			mocks.mutate(variables, callOptions);
			void (async () => {
				await options?.onSuccess?.(undefined, variables, undefined, undefined);
				await callOptions?.onSuccess?.(undefined, variables, undefined, undefined);
				await options?.onSettled?.(undefined, null, variables, undefined, undefined);
				await callOptions?.onSettled?.(undefined, null, variables, undefined, undefined);
			})();
		},
		isPending: mocks.mutationPending,
		error: mocks.mutationError,
	}),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({
		data: { 'row-level-security': mocks.licensed },
		isLoading: false,
		isError: false,
	}),
}));
vi.mock('@/main', () => ({
	trpc: {
		userGroup: {
			rowSecurity: {
				queryOptions: vi.fn(),
				queryKey: vi.fn(() => ['row-security']),
			},
			updateRowSecurity: { mutationOptions: mocks.mutationOptions },
		},
	},
}));
vi.mock('@/components/settings/upgrade-to-enterprise', () => ({
	UpgradeToEnterprise: () => <span>Upgrade to Enterprise</span>,
}));

const objects = [
	{
		databaseType: 'duckdb',
		database: 'analytics',
		schema: 'main',
		table: 'orders',
		columns: ['id', 'tenant_id'],
	},
	{
		databaseType: 'duckdb',
		database: 'analytics',
		schema: 'sales',
		table: 'customers',
		columns: ['id', 'region'],
	},
];

describe('ProjectRowSecurity', () => {
	beforeEach(() => {
		mocks.rowSecurity = { version: 1, tables: [] };
		mocks.licensed = true;
		mocks.queryLoading = false;
		mocks.queryError = false;
		mocks.mutationPending = false;
		mocks.mutationError = null;
		mocks.mutate.mockReset();
		mocks.mutationOptions.mockReset().mockImplementation((options) => options);
		mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
		mocks.refetch.mockReset();
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

	it('shows configured tables as a summary without the catalog tree', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText('analytics/main/orders')).toBeTruthy();
		expect(screen.getByText('tenant_id')).toBeTruthy();
		expect(screen.queryByTestId('project-row-security-tree')).toBeNull();
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	it('leaves only the protected table list bordered', () => {
		render(<ProjectRowSecurity objects={objects} />);

		const protectedTables = screen.getByRole('region', { name: 'Protected tables' });
		const settingsBody = protectedTables.parentElement;

		expect(protectedTables.classList.contains('border')).toBe(true);
		expect(protectedTables.classList.contains('rounded-lg')).toBe(true);
		expect(settingsBody).not.toBeNull();
		expect(settingsBody!.classList.contains('border')).toBe(false);
		expect(settingsBody!.classList.contains('bg-background')).toBe(false);
		expect(settingsBody!.classList.contains('p-4')).toBe(false);
	});

	it('opens the full Add tree with configured tables collapsed', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		openConfiguration();

		expect(screen.getByRole('dialog', { name: 'Add protected tables' })).toBeTruthy();
		expect(screen.getByTestId('project-row-security-tree')).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Search row-level security tables' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cancel' }).classList.contains('rounded-full')).toBe(true);
		expect(screen.getByRole('button', { name: 'Save' }).classList.contains('rounded-full')).toBe(true);
		const databaseButton = screen.getByRole('button', { name: 'Expand analytics database' });
		expect(databaseButton.getAttribute('aria-expanded')).toBe('false');
		expect(databaseButton.className).toContain('cursor-pointer');
		expect(screen.queryByText('main')).toBeNull();
		expect(screen.queryByText('orders')).toBeNull();
		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(screen.getByText('1 configured')).toBeTruthy();

		expandToOrders();
		const tenantCheckbox = screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' });
		expect(tenantCheckbox.getAttribute('data-state')).toBe('checked');
		expect(tenantCheckbox.className).toContain('cursor-pointer');
		expect(tenantCheckbox.parentElement?.className).toContain('cursor-pointer');
		expect(screen.getAllByText('1 configured')).toHaveLength(2);
	});

	it('keeps tree IDs unique for colliding punctuation and non-ASCII keys', () => {
		render(
			<ProjectRowSecurity
				objects={[
					{
						databaseType: 'duckdb',
						database: 'résumé',
						schema: 'sales.eu',
						table: 'orders.eu',
						columns: ['tenant_id'],
					},
					{
						databaseType: 'duckdb',
						database: 'r-sum-',
						schema: 'sales/eu',
						table: 'orders/eu',
						columns: ['tenant_id'],
					},
				]}
			/>,
		);
		openConfiguration();

		const databaseButtons = [
			screen.getByRole('button', { name: 'Expand résumé database' }),
			screen.getByRole('button', { name: 'Expand r-sum- database' }),
		];
		expect(databaseButtons[0].getAttribute('aria-controls')).not.toBe(
			databaseButtons[1].getAttribute('aria-controls'),
		);
		databaseButtons.forEach((button) => fireEvent.click(button));

		const schemaButtons = [
			screen.getByRole('button', { name: 'Expand sales.eu schema' }),
			screen.getByRole('button', { name: 'Expand sales/eu schema' }),
		];
		expect(schemaButtons[0].getAttribute('aria-controls')).not.toBe(schemaButtons[1].getAttribute('aria-controls'));
		schemaButtons.forEach((button) => fireEvent.click(button));

		const tableButtons = [
			screen.getByRole('button', { name: 'Expand orders.eu table columns' }),
			screen.getByRole('button', { name: 'Expand orders/eu table columns' }),
		];
		expect(tableButtons[0].getAttribute('aria-controls')).not.toBe(tableButtons[1].getAttribute('aria-controls'));
		tableButtons.forEach((button) => fireEvent.click(button));

		[...databaseButtons, ...schemaButtons, ...tableButtons].forEach((button) => {
			expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeTruthy();
		});
	});

	it('keeps the tree collapsed when a database matches the search', () => {
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search row-level security tables' }), {
			target: { value: 'a' },
		});

		const database = screen.getByRole('button', { name: 'Expand analytics database' });
		expect(database.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('sales')).toBeNull();
		expect(screen.queryByText('customers')).toBeNull();
		expect(screen.queryByRole('checkbox', { name: 'region constraint column for customers' })).toBeNull();
	});

	it('reveals all matching tables without expanding their columns', () => {
		render(
			<ProjectRowSecurity
				objects={[
					{
						databaseType: 'duckdb',
						database: 'jaffle_shop',
						schema: 'main',
						table: 'customers',
						columns: ['customer_id', 'region'],
					},
					{
						databaseType: 'postgres',
						database: 'warehouse',
						schema: 'reporting',
						table: 'custom_orders',
						columns: ['customer_id', 'total'],
					},
				]}
			/>,
		);
		openConfiguration();
		const search = screen.getByRole('textbox', { name: 'Search row-level security tables' });

		fireEvent.change(search, { target: { value: 'CuStOm' } });

		expect(screen.getByRole('button', { name: 'Collapse jaffle_shop database' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse main schema' })).toBeTruthy();
		expect(
			screen.getByRole('button', { name: 'Expand customers table columns' }).getAttribute('aria-expanded'),
		).toBe('false');
		expect(screen.getByRole('button', { name: 'Collapse warehouse database' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse reporting schema' })).toBeTruthy();
		expect(
			screen.getByRole('button', { name: 'Expand custom_orders table columns' }).getAttribute('aria-expanded'),
		).toBe('false');
		expect(screen.queryByRole('checkbox', { name: 'customer_id constraint column for customers' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: 'customer_id constraint column for custom_orders' })).toBeNull();
	});

	it('opens only the database when a schema matches the search', () => {
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search row-level security tables' }), {
			target: { value: 'main' },
		});

		expect(screen.getByRole('button', { name: 'Collapse analytics database' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Expand main schema' }).getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('orders')).toBeNull();
	});

	it('reveals column-only matches across multiple paths', () => {
		render(
			<ProjectRowSecurity
				objects={[
					...objects,
					{
						databaseType: 'postgres',
						database: 'warehouse',
						schema: 'reporting',
						table: 'stores',
						columns: ['id', 'region_code'],
					},
				]}
			/>,
		);
		openConfiguration();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search row-level security tables' }), {
			target: { value: 'REGION' },
		});

		expect(screen.getByRole('button', { name: 'Collapse analytics database' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse sales schema' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse customers table columns' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'region constraint column for customers' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse warehouse database' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse reporting schema' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse stores table columns' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'region_code constraint column for stores' })).toBeTruthy();
	});

	it('preserves manual expansion when search-driven expansion changes', () => {
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();
		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
		const search = screen.getByRole('textbox', { name: 'Search row-level security tables' });

		fireEvent.change(search, { target: { value: 'region' } });
		expect(screen.getByRole('checkbox', { name: 'region constraint column for customers' })).toBeTruthy();

		fireEvent.change(search, { target: { value: 'a' } });
		expect(screen.getByRole('button', { name: 'Collapse analytics database' }).getAttribute('aria-expanded')).toBe(
			'true',
		);
		expect(screen.getByRole('button', { name: 'Expand sales schema' }).getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('customers')).toBeNull();

		fireEvent.change(search, { target: { value: 'missing' } });
		expect(screen.getByText('No matching tables or columns.')).toBeTruthy();
		fireEvent.change(search, { target: { value: '' } });
		expect(screen.getByRole('button', { name: 'Collapse analytics database' })).toBeTruthy();
	});

	it('discards dialog changes on cancel', () => {
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();
		expandToOrders();
		fireEvent.click(screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog')).toBeNull();
		openConfiguration();
		expandToOrders();
		expect(
			screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }).getAttribute('data-state'),
		).toBe('unchecked');
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('saves the complete registry, invalidates the query, and closes the dialog', async () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();
		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand sales schema' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand customers table columns' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'region constraint column for customers' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutate).toHaveBeenCalledWith(
			{
				version: 1,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						constraintColumns: ['tenant_id'],
					},
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'sales',
						table: 'customers',
						constraintColumns: ['region'],
					},
				],
			},
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
		await waitFor(() => {
			expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['row-security'] });
			expect(screen.queryByRole('dialog')).toBeNull();
		});
	});

	it('opens Edit with only the selected table and its columns', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		const editButton = screen.getByRole('button', { name: 'Edit orders' });
		fireEvent.click(editButton);

		const dialog = screen.getByRole('dialog', { name: 'Edit protected table' });
		expect(within(dialog).getByText('analytics/main/orders')).toBeTruthy();
		expect(within(dialog).getByRole('checkbox', { name: 'id constraint column for orders' })).toBeTruthy();
		expect(
			within(dialog)
				.getByRole('checkbox', { name: 'tenant_id constraint column for orders' })
				.getAttribute('data-state'),
		).toBe('checked');
		expect(within(dialog).queryByRole('textbox')).toBeNull();
		expect(within(dialog).queryByTestId('project-row-security-tree')).toBeNull();
		expect(within(dialog).queryByText('customers')).toBeNull();
		expect(within(dialog).queryByRole('button', { name: /Expand|Collapse/ })).toBeNull();
	});

	it('saves an edited table while preserving unrelated tables', () => {
		mocks.rowSecurity = configuredRegistryWithTwoTables();
		render(<ProjectRowSecurity objects={objects} />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit orders' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'id constraint column for orders' }));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutate).toHaveBeenCalledWith(
			{
				version: 1,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						constraintColumns: ['id', 'tenant_id'],
					},
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'sales',
						table: 'customers',
						constraintColumns: ['region'],
					},
				],
			},
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
	});

	it('discards Edit changes on cancel', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit orders' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'id constraint column for orders' }));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Edit orders' }));

		expect(
			screen.getByRole('checkbox', { name: 'id constraint column for orders' }).getAttribute('data-state'),
		).toBe('unchecked');
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('does not save an edited table without a constraint column', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit orders' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }));

		expect(screen.getByText('Select at least one constraint column to save.')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(mocks.mutate).not.toHaveBeenCalled();
	});

	it('keeps summary controls styled and confirms persisted removal', async () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		const editButton = screen.getByRole('button', { name: 'Edit orders' });
		const removeButton = screen.getByRole('button', { name: 'Remove orders' });
		expect(editButton.classList.contains('rounded-full')).toBe(true);
		expect(editButton.getAttribute('data-size')).toBe('icon-sm');
		expect(removeButton.classList.contains('rounded-full')).toBe(true);
		expect(removeButton.getAttribute('data-size')).toBe('icon-sm');

		fireEvent.click(removeButton);
		expect(screen.getByRole('dialog', { name: 'Remove protected table?' })).toBeTruthy();
		expect(
			screen.getByText('analytics/main/orders will no longer be available for row-level group policies.'),
		).toBeTruthy();
		expect(screen.queryByRole('alertdialog')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog', { name: 'Remove protected table?' })).toBeNull();

		fireEvent.click(removeButton);
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		expect(mocks.mutate).toHaveBeenCalledWith(
			{ version: 1, tables: [] },
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
		await waitFor(() => {
			expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['row-security'] });
			expect(screen.queryByRole('dialog', { name: 'Remove protected table?' })).toBeNull();
		});
	});

	it('shows removal errors and prevents closing while pending', () => {
		mocks.rowSecurity = configuredRegistry();
		mocks.mutationPending = true;
		mocks.mutationError = new Error('Could not remove protected table');
		const { rerender } = render(<ProjectRowSecurity objects={objects} />);

		fireEvent.click(screen.getByRole('button', { name: 'Remove orders' }));

		expect(screen.getByText('Could not remove protected table')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(screen.getByRole('dialog', { name: 'Remove protected table?' })).toBeTruthy();

		mocks.mutationPending = false;
		rerender(<ProjectRowSecurity objects={objects} />);
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog', { name: 'Remove protected table?' })).toBeNull();
	});

	it('shows an actionable empty state', () => {
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText('No protected tables')).toBeTruthy();
		const addButtons = screen.getAllByRole('button', { name: 'Add protected table' });
		expect(addButtons).toHaveLength(2);
		expect(addButtons[0].getAttribute('data-size')).toBe('default');
		expect(addButtons[0].classList.contains('rounded-md')).toBe(true);
		expect(addButtons[0].classList.contains('rounded-full')).toBe(false);
		expect(addButtons[1].classList.contains('rounded-full')).toBe(true);
		expect(screen.queryByTestId('project-row-security-tree')).toBeNull();
	});

	it('lets Edit remove unavailable saved columns', () => {
		mocks.rowSecurity = {
			version: 1,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'analytics',
					schema: 'main',
					table: 'orders',
					constraintColumns: ['missing_column', 'tenant_id'],
				},
				{
					databaseType: 'duckdb',
					database: 'archive',
					schema: 'main',
					table: 'legacy_orders',
					constraintColumns: ['tenant_id'],
				},
			],
		};
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText(/missing_column/).textContent).toContain('unavailable');
		expect(screen.getByText('Some saved columns are unavailable after sync.')).toBeTruthy();
		expect(screen.getByText('archive/main/legacy_orders')).toBeTruthy();
		expect(screen.getByText('Unavailable')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Edit orders' }));
		const missingColumn = screen.getByRole('checkbox', {
			name: 'missing_column constraint column for orders',
		});
		expect(missingColumn.getAttribute('data-state')).toBe('checked');
		expect(within(missingColumn.parentElement!).getByText('Unavailable')).toBeTruthy();
		fireEvent.click(missingColumn);
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(mocks.mutate).toHaveBeenCalledWith(
			{
				version: 1,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						constraintColumns: ['tenant_id'],
					},
					{
						databaseType: 'duckdb',
						database: 'archive',
						schema: 'main',
						table: 'legacy_orders',
						constraintColumns: ['tenant_id'],
					},
				],
			},
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
	});

	it('shows a clear unavailable state when editing a missing table', () => {
		mocks.rowSecurity = {
			version: 1,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'archive',
					schema: 'main',
					table: 'legacy_orders',
					constraintColumns: ['tenant_id'],
				},
			],
		};
		render(<ProjectRowSecurity objects={objects} />);

		fireEvent.click(screen.getByRole('button', { name: 'Edit legacy_orders' }));
		const dialog = screen.getByRole('dialog', { name: 'Edit protected table' });
		expect(within(dialog).getByText('archive/main/legacy_orders')).toBeTruthy();
		expect(within(dialog).getAllByText('Unavailable')).toHaveLength(2);
		expect(
			within(dialog).getByText(
				'This table was not found in the latest sync. Use Remove outside this dialog to stop protecting it.',
			),
		).toBeTruthy();
		expect(
			within(dialog).getByRole('checkbox', {
				name: 'tenant_id constraint column for legacy_orders',
			}),
		).toBeTruthy();
		expect(within(dialog).queryByRole('textbox')).toBeNull();
		expect(within(dialog).queryByTestId('project-row-security-tree')).toBeNull();
	});

	it('shows loading and retry states', () => {
		mocks.queryLoading = true;
		const { rerender } = render(<ProjectRowSecurity objects={objects} />);
		expect(screen.getByText('Loading security settings...')).toBeTruthy();

		mocks.queryLoading = false;
		mocks.queryError = true;
		rerender(<ProjectRowSecurity objects={objects} />);
		expect(screen.getByText('Failed to load security settings')).toBeTruthy();
		const retryButton = screen.getByRole('button', { name: 'Retry' });
		expect(retryButton.classList.contains('rounded-full')).toBe(true);
		fireEvent.click(retryButton);
		expect(mocks.refetch).toHaveBeenCalledOnce();
	});

	it('shows catalog loading and retry states in the dialog', () => {
		const onRetryCatalog = vi.fn();
		const { rerender } = render(
			<ProjectRowSecurity objects={objects} catalogState='loading' onRetryCatalog={onRetryCatalog} />,
		);
		openConfiguration();
		expect(screen.getAllByText('Loading synced tables...')).toHaveLength(2);
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		rerender(<ProjectRowSecurity objects={objects} catalogState='error' onRetryCatalog={onRetryCatalog} />);
		openConfiguration();
		expect(screen.getAllByText('Failed to load synced tables').length).toBeGreaterThan(0);
		fireEvent.click(screen.getAllByRole('button', { name: 'Retry' }).at(-1)!);
		expect(onRetryCatalog).toHaveBeenCalledOnce();
	});

	it('shows the configured summary but disables editing without a license', () => {
		mocks.rowSecurity = configuredRegistry();
		mocks.licensed = false;
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText('Upgrade to Enterprise')).toBeTruthy();
		expect(screen.getByText('analytics/main/orders')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Edit orders' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Remove orders' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Add protected table' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

function configuredRegistry() {
	return {
		version: 1 as const,
		tables: [
			{
				databaseType: 'duckdb',
				database: 'analytics',
				schema: 'main',
				table: 'orders',
				constraintColumns: ['tenant_id'],
			},
		],
	};
}

function configuredRegistryWithTwoTables() {
	return {
		version: 1 as const,
		tables: [
			...configuredRegistry().tables,
			{
				databaseType: 'duckdb',
				database: 'analytics',
				schema: 'sales',
				table: 'customers',
				constraintColumns: ['region'],
			},
		],
	};
}

function openConfiguration() {
	fireEvent.click(screen.getAllByRole('button', { name: 'Add protected table' })[0]);
}

function expandToOrders() {
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));
}
