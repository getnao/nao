// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
	useMutation: () => ({
		mutate: mocks.mutate,
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
			updateRowSecurity: { mutationOptions: vi.fn() },
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
		mocks.mutate.mockImplementation((_registry: unknown, options?: { onSuccess?: () => void }) =>
			options?.onSuccess?.(),
		);
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

	it('opens the searchable tree with existing selections expanded and checked', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		openConfiguration();

		expect(screen.getByRole('dialog', { name: 'Configure protected tables' })).toBeTruthy();
		expect(screen.getByTestId('project-row-security-tree')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cancel' }).classList.contains('rounded-full')).toBe(true);
		expect(screen.getByRole('button', { name: 'Save' }).classList.contains('rounded-full')).toBe(true);
		expect(
			screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }).getAttribute('data-state'),
		).toBe('checked');
		expect(screen.getAllByText('1 configured')).toHaveLength(2);

		fireEvent.change(screen.getByRole('textbox', { name: 'Search row-level security tables' }), {
			target: { value: 'region' },
		});
		expect(screen.getByText('customers')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'region constraint column for customers' })).toBeTruthy();
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

	it('saves the complete registry and closes the dialog', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);
		openConfiguration();
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
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('edits from the summary and confirms persisted removal', () => {
		mocks.rowSecurity = configuredRegistry();
		render(<ProjectRowSecurity objects={objects} />);

		const editButton = screen.getByRole('button', { name: 'Edit orders' });
		const removeButton = screen.getByRole('button', { name: 'Remove orders' });
		expect(editButton.classList.contains('rounded-full')).toBe(true);
		expect(editButton.getAttribute('data-size')).toBe('icon-sm');
		expect(removeButton.classList.contains('rounded-full')).toBe(true);
		expect(removeButton.getAttribute('data-size')).toBe('icon-sm');

		fireEvent.click(editButton);
		expect(screen.getByRole('dialog', { name: 'Configure protected tables' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
		expect(screen.queryByRole('dialog', { name: 'Remove protected table?' })).toBeNull();
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

	it('keeps unavailable saved tables and columns visible', () => {
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

		openConfiguration();
		expect(screen.getByText('Unavailable saved selections')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable selections from orders' }));
		expect(screen.queryByText(/orders: missing_column/)).toBeNull();
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

function openConfiguration() {
	fireEvent.click(screen.getAllByRole('button', { name: 'Add protected table' })[0]);
}

function expandToOrders() {
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));
}
