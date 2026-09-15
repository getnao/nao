import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	initialRowPolicies: { version: 1 as const, policies: [] as unknown[] },
	lockedRowPolicies: { version: 1 as const, policies: [] as unknown[] },
	projectRowSecurity: { version: 1 as const, tables: [] as unknown[] },
	updatedRowPolicies: undefined as unknown,
}));

vi.mock('../src/db/dbConfig', () => ({
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
	default: { dialect: 'postgres' },
}));

vi.mock('../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: vi.fn(),
	listUsersWithProjectAccessDetails: vi.fn(),
}));

vi.mock('../src/db/db', () => ({
	db: {
		select: () => query([storedGroup(ssoMappings(['finance']), mocks.initialRowPolicies)]),
		transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(transaction()),
	},
}));

import { createUserGroup, createUserGroupWithinLimit, updateUserGroup } from '../src/queries/user-group.queries';

describe('PostgreSQL user group updates', () => {
	beforeEach(() => {
		mocks.events.length = 0;
		mocks.initialRowPolicies = { version: 1, policies: [] };
		mocks.lockedRowPolicies = { version: 1, policies: [] };
		mocks.projectRowSecurity = { version: 1, tables: [] };
		mocks.updatedRowPolicies = undefined;
	});

	it('locks the project before changing mappings and deleting memberships', async () => {
		await updateUserGroup('project-1', 'group-1', {
			featureGrants: [],
			ssoMappings: ssoMappings([]),
		});

		expect(mocks.events).toEqual(['lock-project', 'refresh-group', 'update-mapping', 'delete-memberships']);
	});

	it.each([
		{
			operation: 'unlimited create',
			run: () => createUserGroup('project-1', 'Finance'),
			events: ['lock-project', 'check-name', 'insert'],
		},
		{
			operation: 'free-limit create',
			run: () => createUserGroupWithinLimit(3, 'project-1', 'Finance'),
			events: ['lock-project', 'check-name', 'count-groups', 'insert'],
		},
		{
			operation: 'rename',
			run: () => updateUserGroup('project-1', 'group-1', { name: 'Operations', featureGrants: [] }),
			events: ['lock-project', 'refresh-group', 'check-name', 'update-mapping'],
		},
	])('locks before checking and writing during $operation', async ({ run, events }) => {
		await run();

		expect(mocks.events).toEqual(events);
	});

	it('re-reads pruned policies after acquiring the project lock', async () => {
		mocks.initialRowPolicies = rowPolicies('tenant_id');
		mocks.lockedRowPolicies = { version: 1, policies: [] };

		await updateUserGroup('project-1', 'group-1', { featureGrants: [] });

		expect(mocks.events).toEqual(['lock-project', 'refresh-group', 'update-mapping']);
		expect(mocks.updatedRowPolicies).toEqual({ version: 1, policies: [] });
	});

	it('rejects policies validated against a stale project registry', async () => {
		const validatedRegistry = registry('tenant_id');
		mocks.projectRowSecurity = registry('region');

		await expect(
			updateUserGroup('project-1', 'group-1', {
				featureGrants: [],
				rowPolicies: rowPolicies('tenant_id'),
				rowPoliciesRegistry: validatedRegistry,
			}),
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message:
				'Project row security changed while this user group was being updated. Review the current registry and try again.',
		});

		expect(mocks.events).toEqual(['lock-project']);
		expect(mocks.updatedRowPolicies).toBeUndefined();
	});
});

function transaction() {
	return {
		select: (selection?: Record<string, unknown>) => {
			if (selection === undefined) {
				return eventQuery([storedGroup(ssoMappings(['finance']), mocks.lockedRowPolicies)], 'refresh-group');
			}
			if ('rowSecurity' in selection) {
				return lockingQuery([{ id: 'project-1', rowSecurity: mocks.projectRowSecurity }], () =>
					mocks.events.push('lock-project'),
				);
			}
			if ('name' in selection) {
				return eventQuery([], 'check-name');
			}
			if ('count' in selection) {
				return eventQuery([{ count: 0 }], 'count-groups');
			}
			return lockingQuery([{ id: 'project-1' }], () => mocks.events.push('lock-project'));
		},
		insert: () => mutation([storedGroup()], () => mocks.events.push('insert')),
		update: () => mutation([storedGroup(ssoMappings([]))], () => mocks.events.push('update-mapping')),
		delete: () => mutation(undefined, () => mocks.events.push('delete-memberships')),
	};
}

function query(rows: unknown[]) {
	const builder = {
		from: () => builder,
		where: () => builder,
		limit: () => builder,
		for: (_strength: string) => builder,
		execute: vi.fn(async () => rows),
	};
	return builder;
}

function lockingQuery(rows: unknown[], beforeExecute: () => void) {
	const builder = query(rows);
	builder.for = () => {
		builder.execute = vi.fn(async () => {
			beforeExecute();
			return rows;
		});
		return builder;
	};
	return builder;
}

function eventQuery(rows: unknown[], event: string) {
	const builder = query(rows);
	builder.execute = vi.fn(async () => {
		mocks.events.push(event);
		return rows;
	});
	return builder;
}

function mutation(rows: unknown, beforeExecute: () => void) {
	const builder = {
		values: () => builder,
		set: (values: Record<string, unknown>) => {
			mocks.updatedRowPolicies = values.rowPolicies;
			return builder;
		},
		where: () => builder,
		returning: () => builder,
		execute: vi.fn(async () => {
			beforeExecute();
			return rows;
		}),
	};
	return builder;
}

function storedGroup(
	mappings = ssoMappings(['finance']),
	rowPolicies: { version: 1; policies: unknown[] } = { version: 1, policies: [] },
) {
	return {
		id: 'group-1',
		projectId: 'project-1',
		name: 'Finance',
		isDefault: false,
		featureGrants: {
			version: 2,
			features: [],
			toolCallDensity: { defaultDensity: 'detailed', canChange: true },
		},
		contextGrants: null,
		ssoMappings: mappings,
		rowPolicies,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
	};
}

function ssoMappings(oidc: string[]) {
	return {
		version: 1 as const,
		providers: {
			oidc,
			microsoft: [],
		},
	};
}

function registry(constraintColumn: string) {
	return {
		version: 1 as const,
		tables: [
			{
				databaseType: 'duckdb',
				database: 'analytics',
				schema: 'main',
				table: 'orders',
				constraintColumns: [constraintColumn],
			},
		],
	};
}

function rowPolicies(column: string) {
	return {
		version: 1 as const,
		policies: [
			{
				databaseType: 'duckdb',
				database: 'analytics',
				schema: 'main',
				table: 'orders',
				access: 'predicate' as const,
				mode: 'guided' as const,
				combinator: 'and' as const,
				conditions: [{ column, operator: 'equals' as const, value: '7' }],
			},
		],
	};
}
