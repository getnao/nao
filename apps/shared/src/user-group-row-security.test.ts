import { describe, expect, it } from 'vitest';

import {
	compileRowSecurityConditions,
	parseStoredProjectRowSecurity,
	parseStoredUserGroupRowPolicies,
	resolveWarehouseRowSecurity,
	serializeUserGroupRowPolicies,
	stripRowSecurityWhereClause,
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
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', predicate: ' ' }],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', conditions: [] }],
			}),
		).toThrow();
	});

	it('drops legacy raw predicate policies from persisted data', () => {
		expect(
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', predicate: 'tenant_id = 1' }],
			}),
		).toEqual({ version: 1, policies: [] });
	});

	it('migrates legacy guided policies to explicit guided AND policies', () => {
		expect(
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [
					{
						...table,
						access: 'predicate',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
				],
			}),
		).toEqual({
			version: 1,
			policies: [
				{
					...table,
					access: 'predicate',
					mode: 'guided',
					combinator: 'and',
					conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
				},
			],
		});
	});

	it('preserves full and new policies while dropping legacy raw predicates', () => {
		const customers = { ...table, table: 'customers' };
		const invoices = { ...table, table: 'invoices' };
		const refunds = { ...table, table: 'refunds' };

		expect(
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [
					{ ...table, access: 'predicate', predicate: 'tenant_id = 1' },
					{ ...customers, access: 'full' },
					{
						...invoices,
						access: 'predicate',
						mode: 'guided',
						combinator: 'or',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
					{ ...refunds, access: 'predicate', mode: 'sql', predicate: ' where tenant_id = 9 ' },
				],
			}),
		).toEqual({
			version: 1,
			policies: [
				{ ...customers, access: 'full' },
				{
					...invoices,
					access: 'predicate',
					mode: 'guided',
					combinator: 'or',
					conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
				},
				{ ...refunds, access: 'predicate', mode: 'sql', predicate: 'WHERE tenant_id = 9' },
			],
		});
	});

	it('migrates persisted explicit SQL predicates without WHERE', () => {
		expect(
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'tenant_id = 7' }],
			}),
		).toEqual({
			version: 1,
			policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'WHERE tenant_id = 7' }],
		});
	});

	it('requires explicit canonical predicate modes and rejects unknown keys', () => {
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [
					{
						...table,
						access: 'predicate',
						mode: 'guided',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
				],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [
					{
						...table,
						access: 'predicate',
						mode: 'guided',
						combinator: 'xor',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
				],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'tenant_id = 7', extra: true }],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: ' ' }],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'x'.repeat(10_001) }],
			}),
		).toThrow();
		expect(() =>
			serializeUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'tenant_id = 7' }],
			}),
		).toThrow();
		expect(() =>
			serializeUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'WHERE   ' }],
			}),
		).toThrow();
	});

	it('rejects malformed policies that resemble legacy raw predicates', () => {
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', predicate: 'tenant_id = 1', conditions: [] }],
			}),
		).toThrow();
		expect(() =>
			parseStoredUserGroupRowPolicies({
				version: 1,
				policies: [{ ...table, access: 'predicate', predicate: 'x'.repeat(10_001) }],
			}),
		).toThrow();
	});

	it('compiles conditions with AND by default and safely typed literals', () => {
		expect(
			compileRowSecurityConditions(
				[
					{ column: 'tenant_id', operator: 'equals', value: '7' },
					{ column: 'region', operator: 'does-not-equal', value: "Côte d'Ivoire" },
					{ column: 'active', operator: 'equals', value: 'true' },
				],
				'duckdb',
			),
		).toBe(`("tenant_id" = 7 AND "region" <> 'Côte d''Ivoire' AND "active" = TRUE)`);
		expect(compileRowSecurityConditions([{ column: 'tenant`id', operator: 'equals', value: '7' }], 'mysql')).toBe(
			'(`tenant``id` = 7)',
		);
	});

	it('compiles conditions with an explicit OR combinator', () => {
		expect(
			compileRowSecurityConditions(
				[
					{ column: 'tenant_id', operator: 'equals', value: '7' },
					{ column: 'region', operator: 'equals', value: 'west' },
				],
				'duckdb',
				'or',
			),
		).toBe(`("tenant_id" = 7 OR "region" = 'west')`);
	});

	it('strips only a leading WHERE clause', () => {
		expect(stripRowSecurityWhereClause(" \nwhere region = 'EU' ")).toBe("region = 'EU'");
		expect(stripRowSecurityWhereClause('WHERE')).toBeNull();
		expect(stripRowSecurityWhereClause("region = 'EU'")).toBeNull();
		expect(stripRowSecurityWhereClause("SELECT * FROM orders WHERE region = 'EU'")).toBeNull();
	});

	it('compiles comparison, list, and null operators', () => {
		expect(
			compileRowSecurityConditions(
				[
					{ column: 'score', operator: 'greater-than', value: '1.5' },
					{ column: 'score', operator: 'greater-than-or-equal', value: '2' },
					{ column: 'score', operator: 'less-than', value: '10' },
					{ column: 'score', operator: 'less-than-or-equal', value: '9' },
					{ column: 'region', operator: 'is-one-of', value: 'eu, 2, false' },
					{ column: 'region', operator: 'is-not-one-of', value: "north, o'hare" },
					{ column: 'deleted_at', operator: 'is-null' },
					{ column: 'created_at', operator: 'is-not-null' },
				],
				'duckdb',
			),
		).toBe(
			`("score" > 1.5 AND "score" >= 2 AND "score" < 10 AND "score" <= 9 AND ` +
				`"region" IN ('eu', 2, FALSE) AND "region" NOT IN ('north', 'o''hare') AND ` +
				`"deleted_at" IS NULL AND "created_at" IS NOT NULL)`,
		);
	});

	it('rejects malformed and empty condition values', () => {
		expect(() => compileRowSecurityConditions([], 'duckdb')).toThrow();
		expect(() =>
			compileRowSecurityConditions([{ column: 'tenant_id', operator: 'equals', value: ' ' }], 'duckdb'),
		).toThrow();
		expect(() =>
			compileRowSecurityConditions([{ column: 'tenant_id', operator: 'is-one-of', value: '1, , 2' }], 'duckdb'),
		).toThrow();
		expect(() =>
			compileRowSecurityConditions([{ column: 'tenant_id', operator: 'is-null', value: '1' }], 'duckdb'),
		).toThrow();
	});

	it('uses full access when any applicable group grants it', () => {
		const resolved = resolveWarehouseRowSecurity(
			{ version: 1, tables: [{ ...table, constraintColumns: ['tenant_id'] }] },
			[
				{
					version: 1,
					policies: [
						{
							...table,
							access: 'predicate',
							mode: 'guided',
							combinator: 'and',
							conditions: [{ column: 'tenant_id', operator: 'equals', value: '1' }],
						},
					],
				},
				{ version: 1, policies: [{ ...table, access: 'full' }] },
			],
		);

		expect(resolved).toEqual({
			enforced: true,
			tables: [{ ...table, constraintColumns: ['tenant_id'], access: 'full' }],
		});
	});

	it('ORs group policies independently of each guided combinator and denies missing policies', () => {
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
				{
					version: 1,
					policies: [
						{
							...table,
							access: 'predicate',
							mode: 'guided',
							combinator: 'or',
							conditions: [
								{ column: 'tenant_id', operator: 'equals', value: '1' },
								{ column: 'tenant_id', operator: 'equals', value: '2' },
							],
						},
					],
				},
				{
					version: 1,
					policies: [
						{
							...table,
							access: 'predicate',
							mode: 'guided',
							combinator: 'and',
							conditions: [{ column: 'tenant_id', operator: 'greater-than', value: '10' }],
						},
					],
				},
			],
		);

		expect(resolved).toEqual({
			enforced: true,
			tables: [
				{
					...table,
					constraintColumns: ['tenant_id'],
					access: 'predicate',
					predicate: '("tenant_id" = 1 OR "tenant_id" = 2) OR ("tenant_id" > 10)',
				},
				{ ...secondTable, constraintColumns: ['region'], access: 'none' },
			],
		});
	});

	it('wraps manual SQL predicates and ORs them across groups', () => {
		const resolved = resolveWarehouseRowSecurity(
			{ version: 1, tables: [{ ...table, constraintColumns: ['tenant_id'] }] },
			[
				{
					version: 1,
					policies: [
						{
							...table,
							access: 'predicate',
							mode: 'sql',
							predicate: 'WHERE tenant_id = 1 OR tenant_id = 2',
						},
					],
				},
				{
					version: 1,
					policies: [{ ...table, access: 'predicate', mode: 'sql', predicate: 'WHERE tenant_id > 10' }],
				},
			],
		);

		expect(resolved).toEqual({
			enforced: true,
			tables: [
				{
					...table,
					constraintColumns: ['tenant_id'],
					access: 'predicate',
					predicate: '(tenant_id = 1 OR tenant_id = 2) OR (tenant_id > 10)',
				},
			],
		});
	});
});
