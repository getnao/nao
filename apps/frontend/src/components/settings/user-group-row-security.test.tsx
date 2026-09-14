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

function StatefulEditor({ licensed = true }: { licensed?: boolean }) {
	const [policies, setPolicies] = useState<UserGroupRowPolicies>({ version: 1, policies: [] });
	return (
		<UserGroupRowSecurity registry={registry} policies={policies} isLicensed={licensed} onChange={setPolicies} />
	);
}

describe('UserGroupRowSecurity', () => {
	afterEach(cleanup);

	it('defaults to no rows and supports predicate and full access states', () => {
		render(<StatefulEditor />);

		const access = screen.getByRole('combobox', { name: 'Row access for orders' }) as HTMLSelectElement;
		expect(access.value).toBe('none');
		expect(screen.getByText('Constraint columns: tenant_id, region')).toBeTruthy();

		fireEvent.change(access, { target: { value: 'predicate' } });
		const predicate = screen.getByRole('textbox', { name: 'WHERE predicate for orders' });
		expect(screen.getByText('Enter a predicate or choose another access option.')).toBeTruthy();

		fireEvent.change(predicate, { target: { value: 'customer_id = 1' } });
		expect(screen.getByText(/Only constraint columns may be used/)).toBeTruthy();
		fireEvent.change(predicate, { target: { value: "tenant_id = 'west'" } });
		expect(screen.getByText('Use a boolean SQL expression. AND and OR are supported.')).toBeTruthy();

		fireEvent.change(access, { target: { value: 'full' } });
		expect(access.value).toBe('full');
		expect(screen.queryByRole('textbox', { name: 'WHERE predicate for orders' })).toBeNull();
	});

	it('disables policy editing without the row-security license', () => {
		render(<StatefulEditor licensed={false} />);

		expect(screen.getByText('Upgrade to Enterprise')).toBeTruthy();
		expect((screen.getByRole('combobox', { name: 'Row access for orders' }) as HTMLSelectElement).disabled).toBe(
			true,
		);
	});
});
