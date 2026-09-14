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
	mutate: vi.fn(),
	invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: mocks.rowSecurity,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	}),
	useMutation: () => ({
		mutate: mocks.mutate,
		isPending: false,
		error: null,
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
		mocks.mutate.mockReset();
	});

	afterEach(cleanup);

	it('expands the database, schema, table, and constraint columns', () => {
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.queryByText('main')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
		expect(screen.getByText('main')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
		expect(screen.getByText('orders')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));
		expect(screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' })).toBeTruthy();
	});

	it('selects and removes constraint columns and saves the normalized payload', () => {
		render(<ProjectRowSecurity objects={objects} />);
		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));

		const checkbox = screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' });
		fireEvent.click(checkbox);
		expect(checkbox.getAttribute('data-state')).toBe('checked');
		fireEvent.click(checkbox);
		expect(checkbox.getAttribute('data-state')).toBe('unchecked');
		fireEvent.click(checkbox);
		fireEvent.click(screen.getByRole('button', { name: 'Save security' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			version: 1,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'analytics',
					schema: 'main',
					table: 'orders',
					constraintColumns: ['tenant_id'],
				},
			],
		});
	});

	it('reveals column search matches and preserves unavailable saved selections', () => {
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
			],
		};
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText(/missing_column/)).toBeTruthy();
		fireEvent.change(screen.getByRole('textbox', { name: 'Search row-level security tables' }), {
			target: { value: 'tenant_id' },
		});
		expect(screen.getByText('orders')).toBeTruthy();
		expect(
			screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }).getAttribute('data-state'),
		).toBe('checked');
	});

	it('disables editing without the row-security license', () => {
		mocks.licensed = false;
		render(<ProjectRowSecurity objects={objects} />);

		expect(screen.getByText('Upgrade to Enterprise')).toBeTruthy();
		expect(
			(screen.getByRole('textbox', { name: 'Search row-level security tables' }) as HTMLInputElement).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand main schema' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand orders table columns' }));
		expect(
			(screen.getByRole('checkbox', { name: 'tenant_id constraint column for orders' }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
