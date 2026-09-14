import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertUserGroupManageable: vi.fn(),
	countCustomUserGroups: vi.fn(),
	createUserGroup: vi.fn(),
	deleteUserGroup: vi.fn(),
	getUserGroupOverview: vi.fn(),
	getDatabaseContextCatalog: vi.fn(),
	getDocsContextCatalog: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	resolveEffectiveUserGroupAccess: vi.fn(),
	role: 'admin' as 'admin' | 'user' | 'viewer',
	setUserGroupMembership: vi.fn(),
	updateUserGroup: vi.fn(),
	updateProjectRowSecurity: vi.fn(),
	validateWarehouseRowPredicate: vi.fn(),
	UserGroupQueryError: class UserGroupQueryError extends Error {
		constructor(
			public readonly code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN',
			message: string,
		) {
			super(message);
		}
	},
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: mocks.getDatabaseContextCatalog,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/user-group.queries', () => ({
	UserGroupQueryError: mocks.UserGroupQueryError,
	countCustomUserGroups: mocks.countCustomUserGroups,
	createUserGroup: mocks.createUserGroup,
	deleteUserGroup: mocks.deleteUserGroup,
	getUserGroupOverview: mocks.getUserGroupOverview,
	getProjectRowSecurity: mocks.getProjectRowSecurity,
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
	setUserGroupMembership: mocks.setUserGroupMembership,
	updateUserGroup: mocks.updateUserGroup,
	updateProjectRowSecurity: mocks.updateProjectRowSecurity,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { rowLevelSecurity: 'row-level-security', userGroups: 'user-groups' },
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	assertUserGroupManageable: mocks.assertUserGroupManageable,
	getAvailableUserGroupOverview: mocks.getUserGroupOverview,
	resolveAvailableUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
}));
vi.mock('../src/services/docs-context-catalog.service', () => ({
	getDocsContextCatalog: mocks.getDocsContextCatalog,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));
vi.mock('../src/services/warehouse-sql.service', () => ({
	validateWarehouseRowPredicate: mocks.validateWarehouseRowPredicate,
}));

import { router } from '../src/trpc/trpc';
import { userGroupRoutes } from '../src/trpc/user-group.routes';

const testRouter = router(userGroupRoutes);

describe('user group routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'admin';
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'target-user-id' ? 'viewer' : mocks.role,
		);
		mocks.hasFeature.mockResolvedValue(true);
		mocks.countCustomUserGroups.mockResolvedValue(0);
		mocks.getUserGroupOverview.mockResolvedValue({ users: [], groups: [], memberships: [] });
		mocks.getDatabaseContextCatalog.mockReturnValue({ syncState: 'ready', objects: [] });
		mocks.getDocsContextCatalog.mockReturnValue({ syncState: 'ready', entries: [] });
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.updateProjectRowSecurity.mockImplementation(async (_projectId, value) => value);
		mocks.validateWarehouseRowPredicate.mockImplementation(async (predicate) => predicate);
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: ['story-creation'],
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		mocks.createUserGroup.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
	});

	it('requires the RLS entitlement for project security mutations', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().updateRowSecurity({ version: 1, tables: [] })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('allows group edits after a registry update prunes removed-table policies', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
			constraintColumns: ['tenant_id'],
		};
		const customersPolicy = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'customers',
			access: 'full' as const,
		};
		let storedPolicies = {
			version: 1 as const,
			policies: [
				{
					databaseType: orders.databaseType,
					database: orders.database,
					schema: orders.schema,
					table: orders.table,
					access: 'predicate' as const,
					conditions: [{ column: 'tenant_id', operator: 'equals' as const, value: '7' }],
				},
				customersPolicy,
			],
		};
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ ...orders, columns: orders.constraintColumns }],
		});
		mocks.updateProjectRowSecurity.mockImplementation(async (_projectId, registry) => {
			storedPolicies = {
				version: 1,
				policies: storedPolicies.policies.filter((policy) =>
					registry.tables.some(
						(table) =>
							table.databaseType === policy.databaseType &&
							table.database === policy.database &&
							table.schema === policy.schema &&
							table.table === policy.table,
					),
				),
			};
			mocks.getProjectRowSecurity.mockResolvedValue(registry);
			return registry;
		});

		await createCaller().updateRowSecurity({ version: 1, tables: [orders] });
		await createCaller().update({
			groupId: 'group-id',
			featureGrants: ['story-creation'],
			toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
			rowPolicies: storedPolicies,
		});

		expect(storedPolicies.policies).toHaveLength(1);
		expect(storedPolicies.policies[0]).toMatchObject({ table: 'orders' });
		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({
				featureGrants: ['story-creation'],
				rowPolicies: storedPolicies,
			}),
		);
	});

	it('rejects group row policies for tables outside the project registry', async () => {
		await expect(
			createCaller().update({
				groupId: 'group-id',
				featureGrants: [],
				toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
				rowPolicies: {
					version: 1,
					policies: [
						{
							databaseType: 'duckdb',
							database: 'sales',
							schema: 'main',
							table: 'orders',
							access: 'full',
						},
					],
				},
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('validates compiled conditions in the SQL guard before saving', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'sales',
					schema: 'main',
					table: 'orders',
					constraintColumns: ['tenant_id'],
				},
			],
		});

		await createCaller().update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
			rowPolicies: {
				version: 1,
				policies: [
					{
						databaseType: 'duckdb',
						database: 'sales',
						schema: 'main',
						table: 'orders',
						access: 'predicate',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
				],
			},
		});

		expect(mocks.validateWarehouseRowPredicate).toHaveBeenCalledWith('("tenant_id" = 7)', ['tenant_id'], 'duckdb');
		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({
				rowPolicies: expect.objectContaining({
					policies: [
						expect.objectContaining({
							conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
						}),
					],
				}),
			}),
		);
	});

	it('rejects condition columns outside the table registry', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [
				{
					databaseType: 'duckdb',
					database: 'sales',
					schema: 'main',
					table: 'orders',
					constraintColumns: ['tenant_id'],
				},
			],
		});

		await expect(
			updateWithConditions([{ column: 'region', operator: 'equals', value: 'west' }]),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid constraint column for main.orders.' });
		expect(mocks.validateWarehouseRowPredicate).not.toHaveBeenCalled();
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('rejects empty and malformed condition values', async () => {
		await expect(updateWithConditions([])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			updateWithConditions([{ column: 'tenant_id', operator: 'equals', value: ' ' }]),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			updateWithConditions([{ column: 'tenant_id', operator: 'is-one-of', value: '1, ,2' }]),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			updateWithConditions([{ column: 'tenant_id', operator: 'is-null', value: '1' }]),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('returns the overview without an unlimited-groups license', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().overview()).resolves.toEqual({ users: [], groups: [], memberships: [] });
		expect(mocks.getUserGroupOverview).toHaveBeenCalledWith('project-id');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('requires a project admin', async () => {
		mocks.role = 'user';

		await expect(createCaller().overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('validates feature keys and creates a group with unlimited entitlement', async () => {
		await expect(
			createCaller().create({ name: 'Analysts', featureGrants: ['unknown'] as never }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });

		await createCaller().create({
			name: ' Analysts ',
			featureGrants: ['story-creation', 'story-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});

		expect(mocks.hasFeature).toHaveBeenCalledWith('user-groups');
		expect(mocks.countCustomUserGroups).not.toHaveBeenCalled();
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			['story-creation'],
			{
				defaultDensity: 'compact',
				canChange: false,
			},
			{ mode: 'restricted', strict: true, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
		);
	});

	it.each([0, 1, 2])('allows free custom group %s through the free limit', async (customGroupCount) => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.countCustomUserGroups.mockResolvedValue(customGroupCount);

		await expect(createCaller().create({ name: `Group ${customGroupCount + 1}` })).resolves.toEqual({
			id: 'group-id',
			name: 'Analysts',
		});
		expect(mocks.countCustomUserGroups).toHaveBeenCalledWith('project-id');
		expect(mocks.createUserGroup).toHaveBeenCalledOnce();
	});

	it('blocks a forged fourth custom group without unlimited entitlement', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.countCustomUserGroups.mockResolvedValue(3);

		await expect(createCaller().create({ name: 'Fourth group' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Free projects can create up to 3 custom user groups. Enterprise enables unlimited groups.',
		});
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
	});

	it('allows a fourth custom group with unlimited entitlement', async () => {
		mocks.countCustomUserGroups.mockResolvedValue(3);

		await expect(createCaller().create({ name: 'Fourth group' })).resolves.toBeDefined();
		expect(mocks.countCustomUserGroups).not.toHaveBeenCalled();
		expect(mocks.createUserGroup).toHaveBeenCalledOnce();
	});

	it('normalizes provider-specific SSO mappings on create', async () => {
		await createCaller().create({
			name: 'Analysts',
			ssoMappings: {
				version: 1,
				providers: {
					oidc: [' Finance ', 'finance', 'DATA'],
					microsoft: [' A0B1C2D3-E4F5-6789-ABCD-EF0123456789 ', 'a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
				},
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{ mode: 'restricted', strict: true, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
			{
				version: 1,
				providers: {
					oidc: ['finance', 'data'],
					microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
				},
			},
		);
	});

	it('rejects invalid Microsoft Entra group object IDs', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				ssoMappings: {
					version: 1,
					providers: { oidc: [], microsoft: ['not-a-guid'] },
				},
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
	});

	it('normalizes database access on create', async () => {
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' }],
		});
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [
					{ kind: 'schema', databaseType: 'POSTGRES', database: 'app', schema: 'public' },
					{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' },
				],
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{
				mode: 'restricted',
				strict: false,
				grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
				patterns: [],
			},
			{ mode: 'restricted', grants: [] },
		);
	});

	it('normalizes and persists patterns even when they have no current matches', async () => {
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [],
				patterns: [' Future.* ', 'future.*', 'sales.customer_*'],
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{ mode: 'restricted', strict: false, grants: [], patterns: ['future.*', 'sales.customer_*'] },
			{ mode: 'restricted', grants: [] },
		);
	});

	it('bounds pattern count and length', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: Array.from({ length: 201 }, () => 'x') },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: ['x'.repeat(256)] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('rejects malformed docs grants and bounds their size', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '../secret.md' }] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				docsAccess: {
					mode: 'restricted',
					grants: Array.from({ length: 10_001 }, (_, index) => ({
						kind: 'file' as const,
						path: `${index}.md`,
					})),
				},
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('accepts unavailable database and docs grants so they remain removable', async () => {
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'missing',
					},
				],
				patterns: [],
			},
			docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
		});
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{
				mode: 'restricted',
				strict: true,
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'missing',
					},
				],
				patterns: [],
			},
			{ mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
		);
	});

	it('rejects invalid density policies', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				featureGrants: [],
				toolCallDensityPolicy: {
					defaultDensity: 'condensed',
					canChange: true,
				},
			} as never),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				featureGrants: [],
				toolCallDensityPolicy: {
					defaultDensity: 'compact',
					canChange: 'yes',
				},
			} as never),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
	});

	it('updates feature grants and density policy together', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		await createCaller().update({
			groupId: 'group-id',
			name: 'Analysts',
			featureGrants: ['automation-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: 'Analysts',
			featureGrants: ['automation-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('deletes groups and changes memberships without unlimited entitlement', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await createCaller().delete({ groupId: 'group-id' });
		await createCaller().setMembership({ groupId: 'group-id', userId: 'target-user-id', isMember: true });

		expect(mocks.deleteUserGroup).toHaveBeenCalledWith('project-id', 'group-id');
		expect(mocks.setUserGroupMembership).toHaveBeenCalledWith('project-id', 'group-id', 'target-user-id', true);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it.each([
		[
			'update',
			() =>
				createCaller().update({
					groupId: 'locked-id',
					featureGrants: [],
					toolCallDensityPolicy: {
						defaultDensity: 'detailed',
						canChange: true,
					},
				}),
		],
		['delete', () => createCaller().delete({ groupId: 'locked-id' })],
		[
			'setMembership',
			() =>
				createCaller().setMembership({
					groupId: 'locked-id',
					userId: 'target-user-id',
					isMember: true,
				}),
		],
	])('rejects %s for a suspended group', async (_operation, call) => {
		mocks.assertUserGroupManageable.mockRejectedValueOnce(
			new mocks.UserGroupQueryError('FORBIDDEN', 'Upgrade to Enterprise to reactivate this saved group.'),
		);

		await expect(call()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Upgrade to Enterprise to reactivate this saved group.',
		});
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
		expect(mocks.deleteUserGroup).not.toHaveBeenCalled();
		expect(mocks.setUserGroupMembership).not.toHaveBeenCalled();
	});

	it('preserves database access when update omits it', async () => {
		await createCaller().update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: undefined,
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('returns a fresh admin context catalog', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});

		await expect(createCaller().contextCatalog()).resolves.toEqual({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});
		expect(mocks.getDatabaseContextCatalog).toHaveBeenCalledWith('/project');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns an independent admin docs catalog', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getDocsContextCatalog.mockReturnValue({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});

		await expect(createCaller().docsContextCatalog()).resolves.toEqual({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});
		expect(mocks.getDocsContextCatalog).toHaveBeenCalledWith('/project');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns effective access to viewers', async () => {
		mocks.role = 'viewer';

		await expect(createCaller().effectiveAccess()).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('returns effective access for a project user to admins', async () => {
		await expect(createCaller().effectiveAccessForUser({ userId: 'target-user-id' })).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'target-user-id');
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'target-user-id');
	});

	it('rejects effective access for a user outside the project', async () => {
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'missing-user-id' ? null : mocks.role,
		);

		await expect(createCaller().effectiveAccessForUser({ userId: 'missing-user-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: 'This user does not have access to the project.',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('requires an admin for arbitrary-user effective access', async () => {
		mocks.role = 'user';
		await expect(createCaller().effectiveAccessForUser({ userId: 'target-user-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});

		mocks.role = 'admin';
		mocks.hasFeature.mockResolvedValue(false);
		await expect(createCaller().effectiveAccessForUser({ userId: 'target-user-id' })).resolves.toBeDefined();
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns enforced effective access without unlimited entitlement', async () => {
		mocks.role = 'viewer';
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().effectiveAccess()).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: {
				id: 'user-id',
				name: 'Test User',
				email: 'test@example.com',
			},
		},
		selectedProjectId: 'project-id',
	} as never);
}

function updateWithConditions(conditions: Array<{ column: string; operator: string; value?: string }>) {
	return createCaller().update({
		groupId: 'group-id',
		featureGrants: [],
		toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
		rowPolicies: {
			version: 1,
			policies: [
				{
					databaseType: 'duckdb',
					database: 'sales',
					schema: 'main',
					table: 'orders',
					access: 'predicate',
					conditions,
				},
			],
		},
	} as never);
}
