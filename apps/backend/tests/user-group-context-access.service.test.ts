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
	});

	it('returns an explicit bypass when User Groups is unlicensed', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);

		await expect(resolveWarehouseTableAccess('project-1', 'user-1', '/project')).resolves.toEqual({
			enforced: false,
		});
		expect(resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
		expect(getDatabaseContextCatalog).not.toHaveBeenCalled();
	});

	it('rejects revoked principals before returning an unlicensed bypass', async () => {
		vi.mocked(getUserRoleInProject).mockResolvedValue(null);
		vi.mocked(hasFeature).mockResolvedValue(false);

		await expect(resolveWarehouseTableAccess('project-1', 'removed-user', '/project')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
		});
		expect(hasFeature).not.toHaveBeenCalled();
		expect(resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('denies all warehouse tables for restricted access without grants', () => {
		expect(expandDatabaseAccess({ mode: 'restricted', grants: [] }, catalog)).toEqual({
			enforced: true,
			tables: [],
		});
	});

	it('expands a schema grant to every currently synced table', () => {
		expect(
			expandDatabaseAccess(
				{
					mode: 'restricted',
					grants: [
						{
							kind: 'schema',
							databaseType: 'postgres',
							database: 'analytics',
							schema: 'public',
						},
					],
				},
				catalog,
			),
		).toEqual({
			enforced: true,
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
					grants: [
						{
							kind: 'table',
							databaseType: 'snowflake',
							database: 'warehouse',
							schema: 'raw',
							table: 'events',
						},
					],
				},
				catalog,
			),
		).toEqual({
			enforced: true,
			tables: [{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' }],
		});
	});

	it('expands all access and fails closed when the catalog is missing', () => {
		expect(expandDatabaseAccess({ mode: 'all' }, catalog)).toEqual({
			enforced: true,
			tables: catalog.objects,
		});
		expect(expandDatabaseAccess({ mode: 'all' }, { syncState: 'missing', objects: [] })).toEqual({
			enforced: true,
			tables: [],
		});
	});

	it('filters project database objects by canonical identity', () => {
		const access = {
			enforced: true as const,
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
			features: [],
			toolCallDensityPolicy: { defaultDensity: 'medium', canChange: false },
			databaseAccess: { mode: 'all' },
		});
		vi.mocked(getDatabaseContextCatalog).mockImplementation(() => {
			throw new Error('permission denied');
		});

		await expect(resolveWarehouseTableAccess('project-1', 'user-1', '/project')).rejects.toThrow(
			'permission denied',
		);
	});
});
