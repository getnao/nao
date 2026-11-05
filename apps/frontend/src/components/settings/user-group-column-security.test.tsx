// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { UserGroupColumnSecurity } from './user-group-column-security';

afterEach(cleanup);

it('grants only restricted columns on tables available to the group', () => {
	const onChange = vi.fn();
	render(
		<UserGroupColumnSecurity
			registry={{
				version: 1,
				tables: [
					{
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'orders',
						restrictedColumns: ['cost', 'margin'],
					},
					{
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'users',
						restrictedColumns: ['email'],
					},
				],
			}}
			databaseAccess={{
				mode: 'restricted',
				strict: true,
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'orders',
					},
				],
				patterns: [],
			}}
			policies={{ version: 1, policies: [] }}
			isLicensed
			onChange={onChange}
		/>,
	);

	expect(screen.queryByRole('checkbox', { name: 'Grant email on users' })).toBeNull();
	fireEvent.click(screen.getByRole('checkbox', { name: 'Grant cost on orders' }));
	expect(onChange).toHaveBeenCalledWith({
		version: 1,
		policies: [
			{
				databaseType: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'orders',
				grantedColumns: ['cost'],
			},
		],
	});
});
