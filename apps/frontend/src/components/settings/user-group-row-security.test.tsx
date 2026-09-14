// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserGroupRowSecurity } from './user-group-row-security';
import type { UserGroupRowPolicies } from '@nao/shared';
import type { ReactElement, ReactNode } from 'react';

vi.mock('@/components/ui/select', () => ({
	Select: ({
		children,
		value,
		disabled,
		onValueChange,
	}: {
		children: ReactElement[];
		value: string;
		disabled?: boolean;
		onValueChange: (value: string) => void;
	}) => {
		const trigger = children[0] as ReactElement<{ 'aria-label': string }>;
		const content = children[1] as ReactElement<{ children: ReactNode }>;
		return (
			<select
				aria-label={trigger.props['aria-label']}
				value={value}
				disabled={disabled}
				onChange={(event) => onValueChange(event.target.value)}
			>
				{content.props.children}
			</select>
		);
	},
	SelectTrigger: ({ children: _children, ...props }: { children: ReactNode }) => <span {...props} />,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<option value={value}>{children}</option>
	),
}));
vi.mock('@/components/settings/upgrade-to-enterprise', () => ({
	UpgradeToEnterprise: () => <span>Upgrade to Enterprise</span>,
}));

const registry = {
	version: 1 as const,
	tables: [
		{
			databaseType: 'duckdb',
			database: 'analytics',
			schema: 'main',
			table: 'orders',
			constraintColumns: ['tenant_id', 'region'],
		},
	],
};

function StatefulEditor({
	licensed = true,
	initialPolicies = { version: 1, policies: [] },
}: {
	licensed?: boolean;
	initialPolicies?: UserGroupRowPolicies;
}) {
	const [policies, setPolicies] = useState<UserGroupRowPolicies>(initialPolicies);
	return (
		<>
			<UserGroupRowSecurity
				registry={registry}
				policies={policies}
				isLicensed={licensed}
				onChange={setPolicies}
			/>
			<output aria-label='Policy state'>{JSON.stringify(policies)}</output>
		</>
	);
}

describe('UserGroupRowSecurity', () => {
	afterEach(cleanup);

	it('creates a default filtered condition and supports full access', () => {
		render(<StatefulEditor />);

		const access = screen.getByRole('combobox', { name: 'Row access for orders' }) as HTMLSelectElement;
		expect(access.value).toBe('none');
		expect(screen.getByText('Constraint columns: tenant_id, region')).toBeTruthy();

		fireEvent.change(access, { target: { value: 'predicate' } });
		expect(
			(screen.getByRole('combobox', { name: 'Column for orders condition 1' }) as HTMLSelectElement).value,
		).toBe('tenant_id');
		expect(
			(screen.getByRole('combobox', { name: 'Operator for orders condition 1' }) as HTMLSelectElement).value,
		).toBe('equals');
		expect(screen.getByText('Enter a value.')).toBeTruthy();
		expect(readPolicyState().policies[0]).toMatchObject({
			access: 'predicate',
			conditions: [{ column: 'tenant_id', operator: 'equals', value: '' }],
		});

		fireEvent.change(access, { target: { value: 'full' } });
		expect(access.value).toBe('full');
		expect(screen.queryByRole('textbox', { name: 'Value for orders condition 1' })).toBeNull();
	});

	it('adds, edits, and removes ANDed conditions', () => {
		render(<StatefulEditor />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Row access for orders' }), {
			target: { value: 'predicate' },
		});
		fireEvent.change(screen.getByRole('combobox', { name: 'Column for orders condition 1' }), {
			target: { value: 'region' },
		});
		fireEvent.change(screen.getByRole('combobox', { name: 'Operator for orders condition 1' }), {
			target: { value: 'is-one-of' },
		});
		fireEvent.change(screen.getByRole('textbox', { name: 'Value for orders condition 1' }), {
			target: { value: 'west, east' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));

		expect(screen.getByText('All conditions must match.')).toBeTruthy();
		expect(
			(screen.getByRole('combobox', { name: 'Column for orders condition 2' }) as HTMLSelectElement).value,
		).toBe('tenant_id');
		expect(readPolicyState().policies[0]).toMatchObject({
			conditions: [
				{ column: 'region', operator: 'is-one-of', value: 'west, east' },
				{ column: 'tenant_id', operator: 'equals', value: '' },
			],
		});

		fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2 from orders' }));
		expect(screen.queryByRole('combobox', { name: 'Column for orders condition 2' })).toBeNull();
		expect(readPolicyState().policies[0]).toMatchObject({
			conditions: [{ column: 'region', operator: 'is-one-of', value: 'west, east' }],
		});
	});

	it('hides values for null operators and reports invalid lists', () => {
		render(<StatefulEditor />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Row access for orders' }), {
			target: { value: 'predicate' },
		});
		const operator = screen.getByRole('combobox', { name: 'Operator for orders condition 1' });
		fireEvent.change(operator, { target: { value: 'is-null' } });

		expect(screen.queryByRole('textbox', { name: 'Value for orders condition 1' })).toBeNull();
		expect(readPolicyState().policies[0]).toMatchObject({
			conditions: [{ column: 'tenant_id', operator: 'is-null' }],
		});

		fireEvent.change(operator, { target: { value: 'is-not-one-of' } });
		fireEvent.change(screen.getByRole('textbox', { name: 'Value for orders condition 1' }), {
			target: { value: 'west, ,east' },
		});
		expect(screen.getByText('Remove empty items from the comma-separated list.')).toBeTruthy();
	});

	it('leaves only the table policy list bordered', () => {
		render(<StatefulEditor />);

		const policyList = screen.getByRole('region', { name: 'Table row policies' });
		const section = policyList.parentElement;

		expect(policyList.classList.contains('border')).toBe(true);
		expect(policyList.classList.contains('rounded-lg')).toBe(true);
		expect(section).not.toBeNull();
		expect(section!.classList.contains('border')).toBe(false);
		expect(section!.classList.contains('rounded-lg')).toBe(false);
		expect(section!.classList.contains('p-4')).toBe(false);
	});

	it('disables policy editing without the row-security license', () => {
		render(
			<StatefulEditor
				licensed={false}
				initialPolicies={{
					version: 1,
					policies: [
						{
							databaseType: 'duckdb',
							database: 'analytics',
							schema: 'main',
							table: 'orders',
							access: 'predicate',
							conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
						},
					],
				}}
			/>,
		);

		expect(screen.getByText('Upgrade to Enterprise')).toBeTruthy();
		expect((screen.getByRole('combobox', { name: 'Row access for orders' }) as HTMLSelectElement).disabled).toBe(
			true,
		);
		expect(
			(screen.getByRole('combobox', { name: 'Column for orders condition 1' }) as HTMLSelectElement).disabled,
		).toBe(true);
		expect(
			(screen.getByRole('textbox', { name: 'Value for orders condition 1' }) as HTMLInputElement).disabled,
		).toBe(true);
		expect((screen.getByRole('button', { name: 'Add condition' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

function readPolicyState(): UserGroupRowPolicies {
	return JSON.parse(screen.getByLabelText('Policy state').textContent ?? '');
}
