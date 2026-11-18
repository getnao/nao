import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	mockLockingSelectQuery,
	mockMutationQuery,
	mockSelectQuery,
	recordEvent,
} from '../helpers/postgres-query-builder-mocks';

const mocks = vi.hoisted(() => ({
	createTransaction: (() => ({})) as () => unknown,
	events: [] as string[],
	initialContextGrants: null as unknown,
	initialRowPolicies: { version: 1 as const, policies: [] as unknown[] },
	lockedRowPolicies: { version: 1 as const, policies: [] as unknown[] },
	projectRowSecurity: { version: 1 as const, tables: [] as unknown[] },
	selectedProjectRowSecurity: false,
	updatedRowPolicies: undefined as unknown,
}));

vi.mock(
	'../../src/db/dbConfig',
	async () => (await import('../helpers/postgres-query-builder-mocks')).postgresDbConfigMock,
);

vi.mock('../../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: vi.fn(),
	listUsersWithProjectAccessDetails: vi.fn(),
}));

vi.mock('../../src/db/db', async () => {
	const { mockSelectQuery: mockQuery } = await import('../helpers/postgres-query-builder-mocks');
	return {
		db: {
			select: () =>
				mockQuery([
					storedGroup(ssoMappings(['finance']), mocks.initialRowPolicies, mocks.initialContextGrants),
				]),
			transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
				operation(mocks.createTransaction()),
		},
	};
});

import {
	createUserGroup,
	createUserGroupWithinLimit,
	updateProjectRowSecurity,
	updateUserGroup,
} from '../../src/queries/user-group.queries';

beforeEach(() => {
	mocks.events.length = 0;
});

describe('PostgreSQL user group updates', () => {
	beforeEach(() => {
		mocks.createTransaction = userGroupTransaction;
		mocks.initialContextGrants = null;
		mocks.initialRowPolicies = { version: 1, policies: [] };
		mocks.lockedRowPolicies = { version: 1, policies: [] };
		mocks.projectRowSecurity = { version: 1, tables: [] };
		mocks.selectedProjectRowSecurity = false;
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
		mocks.initialContextGrants = {
			version: 4,
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'restricted', grants: [] },
		};
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
		expect(mocks.selectedProjectRowSecurity).toBe(true);
		expect(mocks.updatedRowPolicies).toBeUndefined();
	});
});

describe('PostgreSQL project row security updates', () => {
	beforeEach(() => {
		mocks.createTransaction = projectRowSecurityTransaction;
	});

	it('locks the project before reading or changing user groups', async () => {
		await updateProjectRowSecurity('project-1', { version: 1, tables: [] });

		expect(mocks.events).toEqual(['lock-project:update', 'lock-project', 'select-groups', 'update-project']);
	});
});

function userGroupTransaction() {
	const lockProject = recordEvent(mocks.events, 'lock-project');
	return {
		select: (selection?: Record<string, unknown>) => {
			if (selection === undefined) {
				return eventQuery([storedGroup(ssoMappings(['finance']), mocks.lockedRowPolicies)], 'refresh-group');
			}
			if ('rowSecurity' in selection) {
				mocks.selectedProjectRowSecurity = true;
				return mockLockingSelectQuery(
					[{ id: 'project-1', rowSecurity: mocks.projectRowSecurity }],
					lockProject,
				);
			}
			if ('name' in selection) {
				return eventQuery([], 'check-name');
			}
			if ('count' in selection) {
				return eventQuery([{ count: 0 }], 'count-groups');
			}
			return mockLockingSelectQuery([{ id: 'project-1' }], lockProject);
		},
		insert: () =>
			mockMutationQuery({ result: [storedGroup()], beforeExecute: recordEvent(mocks.events, 'insert') }),
		update: () =>
			mockMutationQuery({
				result: [storedGroup(ssoMappings([]))],
				beforeExecute: recordEvent(mocks.events, 'update-mapping'),
				onSet: (values) => {
					mocks.updatedRowPolicies = values.rowPolicies;
				},
			}),
		delete: () => mockMutationQuery({ beforeExecute: recordEvent(mocks.events, 'delete-memberships') }),
	};
}

function projectRowSecurityTransaction() {
	return {
		select: (selection: Record<string, unknown>) =>
			'rowSecurity' in selection
				? mockLockingSelectQuery([{ id: 'project-1', rowSecurity: { version: 1, tables: [] } }], (strength) => {
						mocks.events.push(`lock-project:${strength}`, 'lock-project');
					})
				: eventQuery([], 'select-groups'),
		update: () => mockMutationQuery({ beforeExecute: recordEvent(mocks.events, 'update-project') }),
	};
}

function eventQuery(rows: unknown[], event: string) {
	return mockSelectQuery(rows, recordEvent(mocks.events, event));
}

function storedGroup(
	mappings = ssoMappings(['finance']),
	rowPolicies: { version: 1; policies: unknown[] } = { version: 1, policies: [] },
	contextGrants: unknown = null,
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
		contextGrants,
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
