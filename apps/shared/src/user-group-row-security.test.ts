import { describe, expect, it } from 'vitest';

import {
	parseStoredProjectRowSecurity,
	parseStoredUserGroupRowPolicies,
	resolveWarehouseRowSecurity,
} from './user-group-row-security';

const table = {
	databaseType: 'duckdb',
	database: 'sales',
	schema: 'main',
	table: 'orders',
};

describe('user group row security', () => {
	it('fails closed for malformed persisted security data', () => {
		expect(() =>
			parseStoredProjectRowSecurity({ version: 1, tables: [{ ...table, constraintColumns: [] }] }),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({ version: 1, policies: [{ ...table, access: 'predicate' }] }),
		).toThrow();
	});

	it('uses full access when any applicable group grants it', () => {
		const resolved = resolveWarehouseRowSecurity(
			{ version: 1, tables: [{ ...table, constraintColumns: ['tenant_id'] }] },
			[
				{ version: 1, policies: [{ ...table, access: 'predicate', predicate: 'tenant_id = 1' }] },
				{ version: 1, policies: [{ ...table, access: 'full' }] },
			],
		);

		expect(resolved).toEqual({
			enforced: true,
			tables: [{ ...table, constraintColumns: ['tenant_id'], access: 'full' }],
		});
	});

	it('ORs predicates and denies a sensitive table with no policy', () => {
		const secondTable = { ...table, table: 'customers' };
		const resolved = resolveWarehouseRowSecurity(
			{
				version: 1,
				tables: [
					{ ...table, constraintColumns: ['tenant_id'] },
					{ ...secondTable, constraintColumns: ['region'] },
				],
			},
			[
				{ version: 1, policies: [{ ...table, access: 'predicate', predicate: 'tenant_id = 1' }] },
				{ version: 1, policies: [{ ...table, access: 'predicate', predicate: 'tenant_id = 2' }] },
			],
		);

		expect(resolved).toEqual({
			enforced: true,
			tables: [
				{
					...table,
					constraintColumns: ['tenant_id'],
					access: 'predicate',
					predicate: '(tenant_id = 1) OR (tenant_id = 2)',
				},
				{ ...secondTable, constraintColumns: ['region'], access: 'none' },
			],
		});
	});
});
