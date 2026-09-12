import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(),
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));
vi.mock('../src/queries/user-group.queries', () => ({
	resolveEffectiveUserGroupAccess: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: vi.fn(),
}));
vi.mock('../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: vi.fn(),
}));

import { getDatabaseContextCatalog } from '../src/agents/user-rules';
import { getUserRoleInProject } from '../src/queries/project.queries';
import { resolveEffectiveUserGroupAccess } from '../src/queries/user-group.queries';
import { hasFeature } from '../src/services/license.service';
import {
	expandDatabaseAccess,
	isDatabaseObjectAllowed,
	resolveProjectContextAccess,
	resolveWarehouseTableAccess,
} from '../src/services/user-group-context-access.service';

const catalog = {
	syncState: 'ready' as const,
	objects: [
		{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' },
		{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'users' },
		{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
	],
};

describe('warehouse Context access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(hasFeature).mockResolvedValue(true);
		vi.mocked(getUserRoleInProject).mockResolvedValue('user');
		vi.mocked(getDatabaseContextCatalog).mockReturnValue(catalog);
		vi.mocked(resolveEffectiveUserGroupAccess).mockResolvedValue({
			groupNames: ['All Users', 'Finance'],
			features: [],
			toolCallDensityPolicy: { defaultDensity: 'medium', canChange: false },
			databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		});
	});

	it('enforces table access without an unlimited-groups entitlement', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);

		await expect(resolveWarehouseTableAccess('project-1', 'user-1', '/project')).resolves.toEqual({
			enforced: true,
			strict: true,
			tables: [],
		});
		expect(resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-1', 'user-1');
		expect(getDatabaseContextCatalog).toHaveBeenCalledWith('/project');
		expect(hasFeature).not.toHaveBeenCalled();
	});

	it('rejects revoked principals before resolving group access', async () => {
		vi.mocked(getUserRoleInProject).mockResolvedValue(null);

		await expect(resolveWarehouseTableAccess('project-1', 'removed-user', '/project')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});
		expect(hasFeature).not.toHaveBeenCalled();
		expect(resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('enforces docs, features, and RULES groups without unlimited entitlement', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		await expect(resolveProjectContextAccess('project-1', 'user-1', '/project')).resolves.toEqual({
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
			docsContextAccess: {
				enforced: true,
				access: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			},
			userGroupFeatures: [],
			userRulesGroupAccess: { enforced: true, groupNames: ['All Users', 'Finance'] },
		});
		expect(hasFeature).not.toHaveBeenCalled();
	});

	it('denies all warehouse tables for restricted access without grants', () => {
		expect(expandDatabaseAccess({ mode: 'restricted', strict: true, grants: [], patterns: [] }, catalog)).toEqual({
			enforced: true,
			strict: true,
			tables: [],
		});
	});

	it('expands a schema grant to every currently synced table', () => {
		expect(
			expandDatabaseAccess(
				{
					mode: 'restricted',
					strict: true,
					grants: [
						{
							kind: 'schema',
							databaseType: 'postgres',
							database: 'analytics',
							schema: 'public',
						},
					],
					patterns: [],
				},
				catalog,
			),
		).toEqual({
			enforced: true,
			strict: true,
			tables: [
				{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' },
				{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'users' },
			],
		});
	});

	it('expands exact table grants without crossing database identities', () => {
		expect(
			expandDatabaseAccess(
				{
					mode: 'restricted',
					strict: true,
					grants: [
						{
							kind: 'table',
							databaseType: 'snowflake',
							database: 'warehouse',
							schema: 'raw',
							table: 'events',
						},
					],
					patterns: [],
				},
				catalog,
			),
		).toEqual({
			enforced: true,
			strict: true,
			tables: [{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' }],
		});
	});

	it('expands patterns across databases without allowing unrelated tables', () => {
		const catalogWithRepeatedName = {
			...catalog,
			objects: [
				...catalog.objects,
				{ databaseType: 'snowflake', database: 'warehouse', schema: 'public', table: 'users' },
			],
		};
		expect(
			expandDatabaseAccess(
				{ mode: 'restricted', strict: true, grants: [], patterns: ['PUBLIC.u*', 'raw.events'] },
				catalogWithRepeatedName,
			),
		).toEqual({
			enforced: true,
			strict: true,
			tables: [
				{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'users' },
				{ databaseType: 'snowflake', database: 'warehouse', schema: 'public', table: 'users' },
				{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
			],
		});
	});

	it('keeps unmatched patterns restrictive until matching tables are synced', () => {
		expect(
			expandDatabaseAccess({ mode: 'restricted', strict: false, grants: [], patterns: ['future.*'] }, catalog),
		).toEqual({
			enforced: true,
			strict: false,
			tables: [],
		});
	});

	it('expands all access and fails closed when the catalog is missing', () => {
		expect(expandDatabaseAccess({ mode: 'all', strict: true }, catalog)).toEqual({
			enforced: true,
			strict: true,
			tables: catalog.objects,
		});
		expect(expandDatabaseAccess({ mode: 'all', strict: false }, { syncState: 'missing', objects: [] })).toEqual({
			enforced: true,
			strict: false,
			tables: [],
		});
	});

	it('filters project database objects when strict mode is off', () => {
		const access = {
			enforced: true as const,
			strict: false,
			tables: [{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
		};

		expect(
			isDatabaseObjectAllowed(access, {
				type: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'orders',
				fqdn: 'analytics.public.orders',
			}),
		).toBe(true);
		expect(
			isDatabaseObjectAllowed(access, {
				type: 'postgres',
				database: 'analytics',
				schema: 'public',
				table: 'users',
				fqdn: 'analytics.public.users',
			}),
		).toBe(false);
	});

	it('surfaces catalog filesystem errors instead of bypassing enforcement', async () => {
		vi.mocked(resolveEffectiveUserGroupAccess).mockResolvedValue({
			groupNames: ['All Users'],
			features: [],
			toolCallDensityPolicy: { defaultDensity: 'medium', canChange: false },
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
		});
		vi.mocked(getDatabaseContextCatalog).mockImplementation(() => {
			throw new Error('permission denied');
		});

		await expect(resolveWarehouseTableAccess('project-1', 'user-1', '/project')).rejects.toThrow(
			'permission denied',
		);
	});
});
