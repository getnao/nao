import { describe, expect, it } from 'vitest';

import {
	filterUserGroupColumnPoliciesByDatabaseContext,
	normalizeProjectColumnSecurity,
	parseStoredProjectColumnSecurity,
	resolveWarehouseColumnSecurity,
} from './user-group-column-security';

const table = {
	databaseType: 'duckdb',
	database: 'analytics',
	schema: 'main',
	table: 'orders',
};

describe('column security', () => {
	it('denies every restricted column when no group grants it', () => {
		expect(
			resolveWarehouseColumnSecurity(
				{ version: 1, tables: [{ ...table, restrictedColumns: ['cost', 'margin'] }] },
				[],
			),
		).toEqual({
			enforced: true,
			tables: [
				{
					...table,
					restrictedColumns: ['cost', 'margin'],
					access: 'restricted',
					deniedColumns: ['cost', 'margin'],
				},
			],
		});
	});

	it('unions grants from all applicable groups', () => {
		expect(
			resolveWarehouseColumnSecurity(
				{ version: 1, tables: [{ ...table, restrictedColumns: ['cost', 'margin'] }] },
				[
					{ version: 1, policies: [{ ...table, grantedColumns: ['cost'] }] },
					{ version: 1, policies: [{ ...table, grantedColumns: ['margin'] }] },
				],
			),
		).toEqual({
			enforced: true,
			tables: [{ ...table, restrictedColumns: ['cost', 'margin'], access: 'full' }],
		});
	});

	it('filters grants through the group database context', () => {
		expect(
			filterUserGroupColumnPoliciesByDatabaseContext(
				{ version: 1, policies: [{ ...table, grantedColumns: ['cost'] }] },
				{ mode: 'restricted', strict: true, grants: [], patterns: [] },
			),
		).toEqual({ version: 1, policies: [] });
	});

	it('normalizes valid storage and rejects malformed non-null storage', () => {
		expect(
			normalizeProjectColumnSecurity({
				version: 1,
				tables: [{ ...table, databaseType: 'DUCKDB', restrictedColumns: ['margin', 'cost'] }],
			}),
		).toEqual({
			version: 1,
			tables: [{ ...table, restrictedColumns: ['cost', 'margin'] }],
		});
		expect(() => parseStoredProjectColumnSecurity({ version: 2, tables: [] })).toThrow(
			'Stored project column security is malformed.',
		);
		expect(() =>
			normalizeProjectColumnSecurity({
				version: 1,
				tables: [{ ...table, restrictedColumns: ['cost', ' cost '] }],
			}),
		).toThrow('Invalid sensitive column definition.');
		expect(() =>
			normalizeProjectColumnSecurity({
				version: 1,
				tables: [
					{ ...table, restrictedColumns: ['cost'] },
					{ ...table, databaseType: 'DUCKDB', restrictedColumns: ['margin'] },
				],
			}),
		).toThrow('Duplicate sensitive table.');
	});
});
