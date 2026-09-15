// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { areUserGroupRowPolicyDraftsValid, UserGroupRowSecurity } from './user-group-row-security';
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
	showValidationErrors = false,
	initialPolicies = { version: 1, policies: [] },
}: {
	licensed?: boolean;
	showValidationErrors?: boolean;
	initialPolicies?: UserGroupRowPolicies;
}) {
	const [policies, setPolicies] = useState<UserGroupRowPolicies>(initialPolicies);
	return (
		<>
			<UserGroupRowSecurity
				registry={registry}
				policies={policies}
				isLicensed={licensed}
				showValidationErrors={showValidationErrors}
				onChange={setPolicies}
			/>
			<output aria-label='Policy state'>{JSON.stringify(policies)}</output>
		</>
	);
}

describe('UserGroupRowSecurity', () => {
	afterEach(cleanup);

	it('validates active drafts against configured columns', () => {
		const policy = {
			databaseType: 'duckdb',
			database: 'analytics',
			schema: 'main',
			table: 'orders',
			access: 'predicate' as const,
			mode: 'guided' as const,
			combinator: 'and' as const,
			conditions: [{ column: 'tenant_id', operator: 'equals' as const, value: '7' }],
		};

		expect(areUserGroupRowPolicyDraftsValid(registry, { version: 1, policies: [policy] })).toBe(true);
		expect(
			areUserGroupRowPolicyDraftsValid(registry, {
				version: 1,
				policies: [{ ...policy, conditions: [{ ...policy.conditions[0], column: 'unconfigured' }] }],
			}),
		).toBe(false);
		expect(
			areUserGroupRowPolicyDraftsValid(registry, {
				version: 1,
				policies: [
					{
						databaseType: policy.databaseType,
						database: policy.database,
						schema: policy.schema,
						table: policy.table,
						access: 'predicate',
						mode: 'sql',
						predicate: 'tenant_id = 7',
					},
				],
			}),
		).toBe(false);
	});

	it('creates a default Guided AND condition and supports full access', () => {
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
		expect(screen.queryByText('Enter a value.')).toBeNull();
		expect(screen.getByRole('textbox', { name: 'Value for orders condition 1' }).getAttribute('aria-invalid')).toBe(
			'false',
		);
		expect(readPolicyState().policies[0]).toMatchObject({
			access: 'predicate',
			mode: 'guided',
			combinator: 'and',
			conditions: [{ column: 'tenant_id', operator: 'equals', value: '' }],
		});
		expect(screen.getByRole('button', { name: 'Guided' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('button', { name: 'AND' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'OR' })).toBeNull();
		expect(screen.queryByText('All conditions must match')).toBeNull();
		expect(screen.queryByText('At least one condition must match')).toBeNull();

		fireEvent.change(access, { target: { value: 'full' } });
		expect(access.value).toBe('full');
		expect(screen.queryByRole('textbox', { name: 'Value for orders condition 1' })).toBeNull();
	});

	it('reveals and retains the combinator when conditions are added and removed', () => {
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

		const controlRow = screen.getByRole('group', { name: 'Filter controls for orders' });
		expect(within(controlRow).getByRole('group', { name: 'Filter mode for orders' }).parentElement).toBe(
			within(controlRow).getByRole('group', { name: 'Condition combination for orders' }).parentElement,
		);
		expect(screen.getByRole('button', { name: 'AND' }).getAttribute('aria-pressed')).toBe('true');
		fireEvent.click(screen.getByRole('button', { name: 'OR' }));
		expect(screen.getByRole('button', { name: 'OR' }).getAttribute('aria-pressed')).toBe('true');
		expect(
			(screen.getByRole('combobox', { name: 'Column for orders condition 2' }) as HTMLSelectElement).value,
		).toBe('tenant_id');
		expect(readPolicyState().policies[0]).toMatchObject({
			mode: 'guided',
			combinator: 'or',
			conditions: [
				{ column: 'region', operator: 'is-one-of', value: 'west, east' },
				{ column: 'tenant_id', operator: 'equals', value: '' },
			],
		});

		fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2 from orders' }));
		expect(screen.queryByRole('combobox', { name: 'Column for orders condition 2' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'AND' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'OR' })).toBeNull();
		expect(readPolicyState().policies[0]).toMatchObject({
			combinator: 'or',
			conditions: [{ column: 'region', operator: 'is-one-of', value: 'west, east' }],
		});

		fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
		expect(screen.getByRole('button', { name: 'OR' }).getAttribute('aria-pressed')).toBe('true');
		expect(readPolicyState().policies[0]).toMatchObject({
			combinator: 'or',
			conditions: [
				{ column: 'region', operator: 'is-one-of', value: 'west, east' },
				{ column: 'tenant_id', operator: 'equals', value: '' },
			],
		});
	});

	it('shows Guided field errors only after validation is enabled', () => {
		const { rerender } = render(<StatefulEditor />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Row access for orders' }), {
			target: { value: 'predicate' },
		});

		const value = screen.getByRole('textbox', { name: 'Value for orders condition 1' });
		expect(screen.queryByText('Enter a value.')).toBeNull();
		expect(value.getAttribute('aria-invalid')).toBe('false');

		rerender(<StatefulEditor showValidationErrors />);
		expect(screen.getByText('Enter a value.')).toBeTruthy();
		expect(value.getAttribute('aria-invalid')).toBe('true');

		fireEvent.change(value, { target: { value: '7' } });
		expect(screen.queryByText('Enter a value.')).toBeNull();
		expect(value.getAttribute('aria-invalid')).toBe('false');
	});

	it('switches between Guided and SQL policies and edits a manual predicate', () => {
		render(<StatefulEditor />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Row access for orders' }), {
			target: { value: 'predicate' },
		});
		fireEvent.change(screen.getByRole('textbox', { name: 'Value for orders condition 1' }), {
			target: { value: '7' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'SQL' }));

		const sql = screen.getByRole('textbox', { name: 'SQL predicate for orders' }) as HTMLTextAreaElement;
		expect(screen.queryByRole('group', { name: 'Condition combination for orders' })).toBeNull();
		expect(sql.value).toBe('WHERE ("tenant_id" = 7)');
		expect(screen.getByText('Enter a WHERE clause. Only configured constraint columns may be used.')).toBeTruthy();
		expect(readPolicyState().policies[0]).toMatchObject({
			access: 'predicate',
			mode: 'sql',
			predicate: 'WHERE ("tenant_id" = 7)',
		});

		fireEvent.change(sql, { target: { value: "tenant_id = 9 OR region = 'west'" } });
		expect(screen.queryByText('Start with WHERE.')).toBeNull();
		expect(readPolicyState().policies[0]).toMatchObject({
			mode: 'sql',
			predicate: "tenant_id = 9 OR region = 'west'",
		});
		fireEvent.change(sql, { target: { value: "WHERE tenant_id = 9 OR region = 'west'" } });
		expect(readPolicyState().policies[0]).toMatchObject({
			mode: 'sql',
			predicate: "WHERE tenant_id = 9 OR region = 'west'",
		});
		fireEvent.change(sql, { target: { value: '' } });
		expect(screen.queryByText('Enter a WHERE clause.')).toBeNull();
		fireEvent.change(sql, { target: { value: ' WHERE ' } });
		expect(screen.queryByText('Enter an expression after WHERE.')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Guided' }));
		expect(readPolicyState().policies[0]).toMatchObject({
			mode: 'guided',
			combinator: 'and',
			conditions: [{ column: 'tenant_id', operator: 'equals', value: '' }],
		});
		expect(screen.queryByText('Enter a value.')).toBeNull();
	});

	it('keeps SQL empty when switching from an incomplete Guided policy', () => {
		render(<StatefulEditor />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Row access for orders' }), {
			target: { value: 'predicate' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'SQL' }));

		const sql = screen.getByRole('textbox', { name: 'SQL predicate for orders' }) as HTMLTextAreaElement;
		expect(sql.value).toBe('');
		expect(sql.placeholder).toBe(`WHERE ("tenant_id" = 'example')`);
		expect(screen.getByText('Enter a WHERE clause. Only configured constraint columns may be used.')).toBeTruthy();
		expect(screen.queryByText('Enter a WHERE clause.')).toBeNull();
		expect(sql.getAttribute('aria-invalid')).toBe('false');
		expect(readPolicyState().policies[0]).toMatchObject({
			access: 'predicate',
			mode: 'sql',
			predicate: '',
		});
	});

	it('shows SQL field errors only after validation is enabled', () => {
		const { rerender } = render(
			<StatefulEditor
				initialPolicies={{
					version: 1,
					policies: [
						{
							databaseType: 'duckdb',
							database: 'analytics',
							schema: 'main',
							table: 'orders',
							access: 'predicate',
							mode: 'sql',
							predicate: '',
						},
					],
				}}
			/>,
		);
		const sql = screen.getByRole('textbox', { name: 'SQL predicate for orders' });

		expect(screen.queryByText('Enter a WHERE clause.')).toBeNull();
		expect(sql.getAttribute('aria-invalid')).toBe('false');
		rerender(<StatefulEditor showValidationErrors />);
		expect(screen.getByText('Enter a WHERE clause.')).toBeTruthy();
		expect(sql.getAttribute('aria-invalid')).toBe('true');

		fireEvent.change(sql, { target: { value: 'tenant_id = 7' } });
		expect(screen.getByText('Start with WHERE.')).toBeTruthy();
		fireEvent.change(sql, { target: { value: 'WHERE tenant_id = 7' } });
		expect(screen.queryByText('Start with WHERE.')).toBeNull();
		expect(sql.getAttribute('aria-invalid')).toBe('false');
	});

	it('hides values for null operators and reports invalid lists', () => {
		render(<StatefulEditor showValidationErrors />);
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
							mode: 'guided',
							combinator: 'and',
							conditions: [
								{ column: 'tenant_id', operator: 'equals', value: '7' },
								{ column: 'region', operator: 'equals', value: 'west' },
							],
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
		expect((screen.getByRole('button', { name: 'Guided' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'SQL' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'AND' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'OR' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Add condition' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('disables manual SQL editing without the row-security license', () => {
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
							mode: 'sql',
							predicate: 'WHERE tenant_id = 7',
						},
					],
				}}
			/>,
		);

		expect(
			(screen.getByRole('textbox', { name: 'SQL predicate for orders' }) as HTMLTextAreaElement).disabled,
		).toBe(true);
		expect((screen.getByRole('button', { name: 'Guided' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'SQL' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

function readPolicyState(): UserGroupRowPolicies {
	return JSON.parse(screen.getByLabelText('Policy state').textContent ?? '');
}
