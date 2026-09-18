import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertUserGroupManageable: vi.fn(),
	createUserGroup: vi.fn(),
	createUserGroupWithinLimit: vi.fn(),
	deleteUserGroup: vi.fn(),
	getUserGroupOverview: vi.fn(),
	getDatabaseContextCatalog: vi.fn(),
	getDocsContextCatalog: vi.fn(),
	listEffectiveEntraUserGroupMappings: vi.fn(),
	listEffectiveOidcUserGroupMappings: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	env: {} as Record<string, string | undefined>,
	resolveUserGroupAccess: vi.fn(),
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
vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: mocks.getDatabaseContextCatalog,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/user-group.queries', () => ({
	UserGroupQueryError: mocks.UserGroupQueryError,
	createUserGroup: mocks.createUserGroup,
	createUserGroupWithinLimit: mocks.createUserGroupWithinLimit,
	deleteUserGroup: mocks.deleteUserGroup,
	getUserGroupOverview: mocks.getUserGroupOverview,
	getProjectRowSecurity: mocks.getProjectRowSecurity,
	resolveUserGroupAccess: mocks.resolveUserGroupAccess,
	setUserGroupMembership: mocks.setUserGroupMembership,
	updateUserGroup: mocks.updateUserGroup,
	updateProjectRowSecurity: mocks.updateProjectRowSecurity,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { rowLevelSecurity: 'row-level-security', sso: 'sso', userGroups: 'user-groups' },
}));
vi.mock('../src/services/sso-user-group-mapping.service', () => ({
	listEffectiveOidcUserGroupMappings: mocks.listEffectiveOidcUserGroupMappings,
	listEffectiveEntraUserGroupMappings: mocks.listEffectiveEntraUserGroupMappings,
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	assertUserGroupManageable: mocks.assertUserGroupManageable,
	getAvailableUserGroupOverview: mocks.getUserGroupOverview,
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));
vi.mock('../src/services/docs-context-catalog.service', () => ({
	getDocsContextCatalog: mocks.getDocsContextCatalog,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => false),
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
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = undefined;
		mocks.env.AZURE_AD_GROUP_NAO_GROUP_MAPPING = undefined;
		mocks.role = 'admin';
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'target-user-id' ? 'viewer' : mocks.role,
		);
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getUserGroupOverview.mockResolvedValue({ users: [], groups: [], memberships: [] });
		mocks.getDatabaseContextCatalog.mockReturnValue({ syncState: 'ready', objects: [] });
		mocks.getDocsContextCatalog.mockReturnValue({ syncState: 'ready', entries: [] });
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.listEffectiveOidcUserGroupMappings.mockResolvedValue([]);
		mocks.listEffectiveEntraUserGroupMappings.mockResolvedValue([]);
		mocks.updateProjectRowSecurity.mockImplementation(async (_projectId, value) => value);
		mocks.validateWarehouseRowPredicate.mockImplementation(async (predicate) => predicate);
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: ['storyCreation'],
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
			rowPolicies: [{ version: 1, policies: [] }],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		mocks.createUserGroup.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
		mocks.createUserGroupWithinLimit.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
	});

	it('requires the RLS entitlement for project security mutations', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().updateRowSecurity({ version: 1, tables: [] })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('limits project constraint columns to the FastAPI maximum', async () => {
		await expect(
			createCaller().updateRowSecurity({
				version: 1,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'sales',
						schema: 'main',
						table: 'orders',
						constraintColumns: Array.from({ length: 257 }, (_, index) => `column_${index}`),
					},
				],
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('rejects unlicensed group creates and updates with row policies before mutation', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		const rowPolicies = {
			version: 1 as const,
			policies: [
				{
					databaseType: 'duckdb',
					database: 'sales',
					schema: 'main',
					table: 'orders',
					access: 'full' as const,
				},
			],
		};

		await expect(createCaller().create({ name: 'Analysts', rowPolicies })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(
			createCaller().update({
				groupId: 'group-id',
				featureGrants: [],
				toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
				rowPolicies,
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });

		expect(mocks.createUserGroup).not.toHaveBeenCalled();
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
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
					mode: 'guided' as const,
					combinator: 'and' as const,
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
			featureGrants: ['storyCreation'],
			toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
			rowPolicies: storedPolicies,
		});

		expect(storedPolicies.policies).toHaveLength(1);
		expect(storedPolicies.policies[0]).toMatchObject({ table: 'orders' });
		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({
				featureGrants: ['storyCreation'],
				rowPolicies: storedPolicies,
				rowPoliciesRegistry: { version: 1, tables: [orders] },
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

	it.each([
		['and', '("tenant_id" = 7 AND "tenant_id" > 2)'],
		['or', '("tenant_id" = 7 OR "tenant_id" > 2)'],
	] as const)('validates guided %s conditions in the SQL guard before saving', async (combinator, compiled) => {
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
						mode: 'guided',
						combinator,
						conditions: [
							{ column: 'tenant_id', operator: 'equals', value: '7' },
							{ column: 'tenant_id', operator: 'greater-than', value: '2' },
						],
					},
				],
			},
		});

		expect(mocks.validateWarehouseRowPredicate).toHaveBeenCalledWith(compiled, ['tenant_id'], 'duckdb');
		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({
				rowPolicies: expect.objectContaining({
					policies: [
						expect.objectContaining({
							mode: 'guided',
							combinator,
							conditions: [
								{ column: 'tenant_id', operator: 'equals', value: '7' },
								{ column: 'tenant_id', operator: 'greater-than', value: '2' },
							],
						}),
					],
				}),
			}),
		);
	});

	it('validates and stores normalized manual SQL predicates', async () => {
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
		mocks.validateWarehouseRowPredicate.mockResolvedValue('"tenant_id" = 7');

		await updateWithSql('WHERE tenant_id=7');

		expect(mocks.validateWarehouseRowPredicate).toHaveBeenCalledWith('tenant_id=7', ['tenant_id'], 'duckdb');
		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({
				rowPolicies: {
					version: 1,
					policies: [
						expect.objectContaining({
							access: 'predicate',
							mode: 'sql',
							predicate: 'WHERE "tenant_id" = 7',
						}),
					],
				},
			}),
		);
	});

	it('rejects unsafe or unconfigured manual SQL predicates', async () => {
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
		mocks.validateWarehouseRowPredicate.mockRejectedValue(new Error('Column "region" is not allowed.'));

		await expect(updateWithSql("WHERE region = 'west'")).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Column "region" is not allowed.',
		});
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('rejects bare manual SQL predicates before validation', async () => {
		await expect(updateWithSql('tenant_id = 7')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.validateWarehouseRowPredicate).not.toHaveBeenCalled();
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it.each([' ', 'WHERE', ' where   '])(
		'rejects incomplete manual SQL predicate %j before validation',
		async (predicate) => {
			await expect(updateWithSql(predicate)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
			expect(mocks.validateWarehouseRowPredicate).not.toHaveBeenCalled();
			expect(mocks.updateUserGroup).not.toHaveBeenCalled();
		},
	);

	it('rejects full queries in manual SQL mode', async () => {
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
		mocks.validateWarehouseRowPredicate.mockRejectedValue(new Error('Subqueries are not allowed.'));

		await expect(updateWithSql('WHERE EXISTS (SELECT 1 FROM orders)')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Subqueries are not allowed.',
		});
		expect(mocks.validateWarehouseRowPredicate).toHaveBeenCalledWith(
			'EXISTS (SELECT 1 FROM orders)',
			['tenant_id'],
			'duckdb',
		);
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('rejects mode-less predicate request shapes', async () => {
		const identity = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
			access: 'predicate',
		};
		for (const policy of [
			{ ...identity, conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }] },
			{ ...identity, predicate: 'tenant_id = 7' },
		]) {
			await expect(
				createCaller().update({
					groupId: 'group-id',
					featureGrants: [],
					toolCallDensityPolicy: { defaultDensity: 'compact', canChange: false },
					rowPolicies: { version: 1, policies: [policy] },
				} as never),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		}
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
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

	it('returns project-scoped effective OIDC env mappings to licensed admins', async () => {
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = 'finance:*:Analysts';
		mocks.listEffectiveOidcUserGroupMappings.mockResolvedValue([
			{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);

		await expect(createCaller().effectiveOidcEnvMappings()).resolves.toEqual([
			{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);
		expect(mocks.hasFeature).toHaveBeenCalledWith('sso');
		expect(mocks.listEffectiveOidcUserGroupMappings).toHaveBeenCalledWith('project-id', [
			{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'analysts' },
		]);
	});

	it('fails safely when OIDC env mapping visibility is unavailable', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		await expect(createCaller().effectiveOidcEnvMappings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.listEffectiveOidcUserGroupMappings).not.toHaveBeenCalled();

		mocks.hasFeature.mockResolvedValue(true);
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = 'invalid';
		await expect(createCaller().effectiveOidcEnvMappings()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
		});
		expect(mocks.listEffectiveOidcUserGroupMappings).not.toHaveBeenCalled();

		mocks.role = 'user';
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = undefined;
		await expect(createCaller().effectiveOidcEnvMappings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.hasFeature).toHaveBeenCalledTimes(2);
	});

	it('returns project-scoped effective Entra env mappings to licensed admins', async () => {
		const groupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		mocks.env.AZURE_AD_GROUP_NAO_GROUP_MAPPING = `${groupId}:*:Analysts`;
		mocks.listEffectiveEntraUserGroupMappings.mockResolvedValue([
			{ identifier: groupId, targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);

		await expect(createCaller().effectiveMicrosoftEnvMappings()).resolves.toEqual([
			{ identifier: groupId, targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);
		expect(mocks.listEffectiveEntraUserGroupMappings).toHaveBeenCalledWith('project-id', [
			{ entraGroupId: groupId, projectScope: '*', naoUserGroup: 'analysts' },
		]);
	});

	it('validates feature keys and creates a group with unlimited entitlement', async () => {
		await expect(
			createCaller().create({ name: 'Analysts', featureGrants: ['unknown'] as never }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });

		await createCaller().create({
			name: ' Analysts ',
			featureGrants: ['storyCreation', 'storyCreation'],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});

		expect(mocks.hasFeature).toHaveBeenCalledWith('user-groups');
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			['storyCreation'],
			{
				defaultDensity: 'compact',
				canChange: false,
			},
			{ mode: 'restricted', strict: false, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
		);
	});

	it('creates free custom groups through the atomic limit query', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().create({ name: 'Group' })).resolves.toEqual({
			id: 'group-id',
			name: 'Analysts',
		});
		expect(mocks.createUserGroupWithinLimit).toHaveBeenCalledWith(
			3,
			'project-id',
			'Group',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{ mode: 'restricted', strict: false, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
		);
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
	});

	it('blocks a forged fourth custom group without unlimited entitlement', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.createUserGroupWithinLimit.mockRejectedValue(
			new mocks.UserGroupQueryError(
				'FORBIDDEN',
				'Free projects can create up to 3 custom user groups. Enterprise enables unlimited groups.',
			),
		);

		await expect(createCaller().create({ name: 'Fourth group' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Free projects can create up to 3 custom user groups. Enterprise enables unlimited groups.',
		});
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
		expect(mocks.createUserGroupWithinLimit).toHaveBeenCalledOnce();
	});

	it('allows a fourth custom group with unlimited entitlement', async () => {
		await expect(createCaller().create({ name: 'Fourth group' })).resolves.toBeDefined();
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
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
				defaultProjectRole: 'context_admin',
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{ mode: 'restricted', strict: false, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
			{
				version: 1,
				providers: {
					oidc: ['finance', 'data'],
					microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
				},
				defaultProjectRole: 'context_admin',
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
			featureGrants: ['automationCreation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: 'Analysts',
			featureGrants: ['automationCreation'],
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
				storyCreation: true,
				automationCreation: false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('returns effective access for a project user to admins', async () => {
		await expect(createCaller().effectiveAccessForUser({ userId: 'target-user-id' })).resolves.toEqual({
			features: {
				storyCreation: true,
				automationCreation: false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
			rowPolicies: [{ version: 1, policies: [] }],
		});
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'target-user-id');
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'target-user-id');
	});

	it('rejects effective access for a user outside the project', async () => {
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'missing-user-id' ? null : mocks.role,
		);

		await expect(createCaller().effectiveAccessForUser({ userId: 'missing-user-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: 'This user does not have access to the project.',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
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
				storyCreation: true,
				automationCreation: false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
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
					mode: 'guided',
					combinator: 'and',
					conditions,
				},
			],
		},
	} as never);
}

function updateWithSql(predicate: string) {
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
					mode: 'sql',
					predicate,
				},
			],
		},
	});
}
