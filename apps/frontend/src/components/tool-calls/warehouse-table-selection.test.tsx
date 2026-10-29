// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	getAllWarehouseTableKeys,
	getCompactWarehouseTableSelection,
	getWarehouseTableKey,
	WarehouseTableSelection,
} from './warehouse-table-selection';
import type { WarehouseSchemaInventory, WarehouseTableSelectionMode } from './warehouse-table-selection';

vi.mock('@/main', () => ({ trpc: {} }));

const schemas: WarehouseSchemaInventory[] = [
	{ schema: 'public', tables: ['customers', 'orders'] },
	{ schema: 'warehouse', tables: ['events'] },
];

afterEach(cleanup);

describe('WarehouseTableSelection', () => {
	it('starts with every table selected and supports table, schema, and bulk selection', () => {
		const onSubmit = vi.fn();
		render(<SelectionHarness onSubmit={onSubmit} />);

		expect(screen.getByText('3 of 3 selected')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Everything/ }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('textbox', { name: 'Search schemas and tables' })).toBeNull();
		expect(screen.queryByText('Warehouse')).toBeNull();
		expect(screen.queryByText('Inherited')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		expect(screen.getByText('0 of 3 selected')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'orders table access' }));
		expect(screen.getByText('1 of 3 selected')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'public schema access' }).dataset.state).toBe('indeterminate');

		fireEvent.click(screen.getByRole('checkbox', { name: 'public schema access' }));
		expect(screen.getByText('2 of 3 selected')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: /Everything/ }));
		expect(screen.getByText('3 of 3 selected')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it('filters by table and schema without changing the selection', () => {
		render(<SelectionHarness onSubmit={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'customers table access' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Search schemas and tables' }), {
			target: { value: 'events' },
		});

		expect(screen.getByText('events')).toBeTruthy();
		expect(screen.queryByText('orders')).toBeNull();
		expect(screen.getByText('1 of 3 selected')).toBeTruthy();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search schemas and tables' }), {
			target: { value: 'public' },
		});

		expect(screen.getByText('customers')).toBeTruthy();
		expect(screen.getByText('orders')).toBeTruthy();
		expect(screen.queryByText('events')).toBeNull();
		expect(screen.getByText('1 of 3 selected')).toBeTruthy();
	});

	it('keeps a complete manual selection in specific mode', () => {
		render(<SelectionHarness onSubmit={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'customers table access' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'orders table access' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand warehouse folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'events table access' }));

		expect(screen.getByText('3 of 3 selected')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Specific selection/ }).getAttribute('aria-pressed')).toBe('true');
	});

	it('keeps every table editable once its whole schema is selected', () => {
		render(<SelectionHarness onSubmit={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'public schema access' }));
		expect(screen.getByText('2 of 3 selected')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'public schema access' }).dataset.state).toBe('checked');

		const orders = screen.getByRole('checkbox', { name: 'orders table access' }) as HTMLButtonElement;
		expect(orders.disabled).toBe(false);
		fireEvent.click(orders);
		expect(screen.getByText('1 of 3 selected')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'customers table access' }).dataset.state).toBe('checked');
		expect(screen.getByRole('checkbox', { name: 'public schema access' }).dataset.state).toBe('indeterminate');

		fireEvent.click(screen.getByRole('checkbox', { name: 'orders table access' }));
		expect(screen.getByRole('checkbox', { name: 'public schema access' }).dataset.state).toBe('checked');
		expect((screen.getByRole('checkbox', { name: 'customers table access' }) as HTMLButtonElement).disabled).toBe(
			false,
		);

		fireEvent.click(screen.getByRole('checkbox', { name: 'public schema access' }));
		expect(screen.getByText('0 of 3 selected')).toBeTruthy();
	});

	it('collapses and expands a schema from the arrow beside its name', () => {
		render(<SelectionHarness onSubmit={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		expect(screen.getByText('customers')).toBeTruthy();
		expect(screen.getByText('orders')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Collapse public folder' }));
		expect(screen.queryByText('customers')).toBeNull();
		expect(screen.queryByText('orders')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		expect(screen.getByText('customers')).toBeTruthy();
		expect(screen.getByText('orders')).toBeTruthy();
	});

	it('compacts fully selected schemas while keeping partial selections explicit', () => {
		const selectedTableKeys = new Set([
			getWarehouseTableKey('public', 'customers'),
			getWarehouseTableKey('public', 'orders'),
			getWarehouseTableKey('warehouse', 'events'),
		]);

		expect(getCompactWarehouseTableSelection(schemas, selectedTableKeys)).toEqual({
			schemas: ['public', 'warehouse'],
			tables: [],
		});

		selectedTableKeys.delete(getWarehouseTableKey('public', 'orders'));
		expect(getCompactWarehouseTableSelection(schemas, selectedTableKeys)).toEqual({
			schemas: ['warehouse'],
			tables: [{ schema: 'public', table: 'customers' }],
		});
	});
});

function SelectionHarness({ onSubmit }: { onSubmit: () => void }) {
	const [selectionMode, setSelectionMode] = useState<WarehouseTableSelectionMode>('all');
	const [selectedTableKeys, setSelectedTableKeys] = useState(() => getAllWarehouseTableKeys(schemas));

	return (
		<WarehouseTableSelection
			schemas={schemas}
			databaseType='postgres'
			databaseLabel='Warehouse'
			selectionMode={selectionMode}
			selectedTableKeys={selectedTableKeys}
			isPending={false}
			error={null}
			onSelectionModeChange={setSelectionMode}
			onChange={setSelectedTableKeys}
			onBack={vi.fn()}
			onSubmit={onSubmit}
		/>
	);
}
