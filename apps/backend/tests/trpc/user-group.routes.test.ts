import { EMPTY_FILES_CONTEXT_ACCESS, EMPTY_MCP_ACCESS } from '@nao/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	assertUserGroupManageable: vi.fn(),
	createUserGroup: vi.fn(),
	createUserGroupWithinLimit: vi.fn(),
	deleteUserGroup: vi.fn(),
	getUserGroupOverview: vi.fn(),
	getDatabaseContextCatalog: vi.fn(),
	getDocsContextCatalog: vi.fn(),
	getFilesContextCatalog: vi.fn(),
	listEffectiveEntraUserGroupMappings: vi.fn(),
	listEffectiveOidcUserGroupMappings: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	getShareAudience: vi.fn(),
	getUserRoleInProject: vi.fn(),
	hasFeature: vi.fn(),
	listUserGroups: vi.fn(),
	previewProjectWideShareRevocation: vi.fn(),
	revokeUnauthorizedProjectWideShares: vi.fn(),
	env: {} as Record<string, string | undefined>,
	resolveUserGroupAccess: vi.fn(),
	role: 'admin' as 'admin' | 'user' | 'viewer',
	setGroupBudget: vi.fn(),
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

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/env', () => ({ env: mocks.env }));
vi.mock('../../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: mocks.getDatabaseContextCatalog,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/queries/user-group.queries', () => ({
	UserGroupQueryError: mocks.UserGroupQueryError,
	createUserGroup: mocks.createUserGroup,
	createUserGroupWithinLimit: mocks.createUserGroupWithinLimit,
	deleteUserGroup: mocks.deleteUserGroup,
	getUserGroupOverview: mocks.getUserGroupOverview,
	getProjectRowSecurity: mocks.getProjectRowSecurity,
	listUserGroups: mocks.listUserGroups,
	resolveUserGroupAccess: mocks.resolveUserGroupAccess,
	setUserGroupMembership: mocks.setUserGroupMembership,
	updateUserGroup: mocks.updateUserGroup,
	updateProjectRowSecurity: mocks.updateProjectRowSecurity,
}));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: {
		rowLevelSecurity: 'row-level-security',
		sso: 'sso',
		userBudget: 'user-budget',
		userGroups: 'user-groups',
	},
}));
vi.mock('../../src/services/member-budget.service', () => ({ setGroupBudget: mocks.setGroupBudget }));
vi.mock('../../src/services/project-sharing.service', () => ({
	getShareAudience: mocks.getShareAudience,
	previewProjectWideShareRevocation: mocks.previewProjectWideShareRevocation,
	revokeUnauthorizedProjectWideShares: mocks.revokeUnauthorizedProjectWideShares,
}));
vi.mock('../../src/services/sso-user-group-mapping.service', () => ({
	listEffectiveOidcUserGroupMappings: mocks.listEffectiveOidcUserGroupMappings,
	listEffectiveEntraUserGroupMappings: mocks.listEffectiveEntraUserGroupMappings,
}));
vi.mock('../../src/services/user-group-availability.service', () => ({
	assertUserGroupManageable: mocks.assertUserGroupManageable,
	getAvailableUserGroupOverview: mocks.getUserGroupOverview,
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));
vi.mock('../../src/services/file-tree-catalog.service', () => ({
	getDocsContextCatalog: mocks.getDocsContextCatalog,
	getFilesContextCatalog: mocks.getFilesContextCatalog,
}));
vi.mock('../../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => false),
}));
vi.mock('../../src/services/warehouse-sql.service', () => ({
	validateWarehouseRowPredicate: mocks.validateWarehouseRowPredicate,
}));

import { router } from '../../src/trpc/trpc';
import { userGroupRoutes } from '../../src/trpc/user-group.routes';

const testRouter = router(userGroupRoutes);
const caller = createTestCaller(testRouter);
const ORDERS_POLICY_TABLE = { databaseType: 'duckdb', database: 'sales', schema: 'main', table: 'orders' };
const ORDERS_TABLE = { ...ORDERS_POLICY_TABLE, constraintColumns: ['tenant_id'] };
const RESTRICTED_DATABASE_ACCESS = { mode: 'restricted', strict: false, grants: [], patterns: [] };
const RESTRICTED_DOCS_ACCESS = { mode: 'restricted', grants: [] };
const DETAILED_DENSITY_POLICY = { defaultDensity: 'detailed', canChange: true } as const;
const COMPACT_DENSITY_POLICY = { defaultDensity: 'compact', canChange: false } as const;

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
	mocks.getFilesContextCatalog.mockReturnValue({ syncState: 'ready', entries: [] });
	mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
	mocks.listEffectiveOidcUserGroupMappings.mockResolvedValue([]);
	mocks.listEffectiveEntraUserGroupMappings.mockResolvedValue([]);
	mocks.updateProjectRowSecurity.mockImplementation(async (_projectId, value) => value);
	mocks.validateWarehouseRowPredicate.mockImplementation(async (predicate) => predicate);
	mocks.resolveUserGroupAccess.mockResolvedValue({
		features: ['storyCreation'],
		databaseAccess: RESTRICTED_DATABASE_ACCESS,
		docsAccess: RESTRICTED_DOCS_ACCESS,
		rowPolicies: [{ version: 1, policies: [] }],
		toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
	});
	mocks.createUserGroup.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
	mocks.createUserGroupWithinLimit.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
});

describe('user group routes', () => {
	it('allows unlicensed row-security table removals', async () => {
		const customers = { ...ORDERS_TABLE, table: 'customers' };
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [ORDERS_TABLE, customers] });
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ ...ORDERS_TABLE, columns: ORDERS_TABLE.constraintColumns }],
		});

		await expect(caller.updateRowSecurity({ version: 1, tables: [ORDERS_TABLE] })).resolves.toEqual({
			version: 1,
			tables: [ORDERS_TABLE],
		});
		expect(mocks.updateProjectRowSecurity).toHaveBeenCalledWith('project-id', {
			version: 1,
			tables: [ORDERS_TABLE],
		});
	});

	it('rejects unlicensed row-security table additions', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(
			caller.updateRowSecurity({
				version: 1,
				tables: [ORDERS_TABLE],
			}),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('rejects unlicensed row-security constraint column changes', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [ORDERS_TABLE] });

		await expect(
			caller.updateRowSecurity({
				version: 1,
				tables: [{ ...ORDERS_TABLE, constraintColumns: ['region'] }],
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('limits project constraint columns to the FastAPI maximum', async () => {
		await expect(
			caller.updateRowSecurity({
				version: 1,
				tables: [
					{
						...ORDERS_TABLE,
						constraintColumns: Array.from({ length: 257 }, (_, index) => `column_${index}`),
					},
				],
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('rejects project row security tables outside the synced catalog', async () => {
		await expect(
			caller.updateRowSecurity({
				version: 1,
				tables: [ORDERS_TABLE],
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Table main.orders is not in the synced catalog.',
		});
		expect(mocks.updateProjectRowSecurity).not.toHaveBeenCalled();
	});

	it('rejects unlicensed group creates and updates with row policies before mutation', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		const rowPolicies = {
			version: 1 as const,
			policies: [{ ...ORDERS_POLICY_TABLE, access: 'full' as const }],
		};

		await expect(caller.create({ name: 'Analysts', rowPolicies })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(
			caller.update({
				groupId: 'group-id',
				featureGrants: [],
				toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
				rowPolicies,
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });

		expect(mocks.createUserGroup).not.toHaveBeenCalled();
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('rejects unlicensed MCP restrictions but lets admins keep or lift them', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		const githubOnly = { mode: 'restricted' as const, grants: [{ kind: 'server' as const, server: 'github' }] };
		mocks.listUserGroups.mockResolvedValue([{ id: 'group-id', mcpAccess: githubOnly }]);
		const update = (mcpAccess: typeof githubOnly | { mode: 'all' }) =>
			caller.update({
				groupId: 'group-id',
				featureGrants: [],
				toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
				mcpAccess,
			});

		await expect(caller.create({ name: 'Analysts', mcpAccess: githubOnly })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(update(EMPTY_MCP_ACCESS as typeof githubOnly)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();

		await update(githubOnly);
		await update({ mode: 'all' });
		await caller.create({ name: 'Analysts' });
		expect(mocks.updateUserGroup).toHaveBeenNthCalledWith(
			1,
			'project-id',
			'group-id',
			expect.objectContaining({ mcpAccess: githubOnly }),
		);
		expect(mocks.updateUserGroup).toHaveBeenNthCalledWith(
			2,
			'project-id',
			'group-id',
			expect.objectContaining({ mcpAccess: { mode: 'all' } }),
		);
		expect(mocks.createUserGroupWithinLimit).toHaveBeenCalledTimes(1);
	});

	it('allows group edits after a registry update prunes removed-table policies', async () => {
		const customersPolicy = { ...ORDERS_POLICY_TABLE, table: 'customers', access: 'full' as const };
		let storedPolicies = {
			version: 1 as const,
			policies: [
				{
					...ORDERS_POLICY_TABLE,
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
			objects: [{ ...ORDERS_TABLE, columns: ORDERS_TABLE.constraintColumns }],
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

		await caller.updateRowSecurity({ version: 1, tables: [ORDERS_TABLE] });
		await caller.update({
			groupId: 'group-id',
			featureGrants: ['storyCreation'],
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
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
				rowPoliciesRegistry: { version: 1, tables: [ORDERS_TABLE] },
			}),
		);
	});

	it('rejects group row policies for tables outside the project registry', async () => {
		await expect(
			caller.update({
				groupId: 'group-id',
				featureGrants: [],
				toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
				rowPolicies: {
					version: 1,
					policies: [{ ...ORDERS_POLICY_TABLE, access: 'full' }],
				},
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it.each([
		['and', '("tenant_id" = 7 AND "tenant_id" > 2)'],
		['or', '("tenant_id" = 7 OR "tenant_id" > 2)'],
	] as const)('validates guided %s conditions in the SQL guard before saving', async (combinator, compiled) => {
		mockOrdersRowSecurity();

		await caller.update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
			rowPolicies: {
				version: 1,
				policies: [
					{
						...ORDERS_POLICY_TABLE,
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
		mockOrdersRowSecurity();
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

	it.each(['tenant_id = 7', ' ', 'WHERE', ' where   '])(
		'rejects bare or incomplete manual SQL predicate %j before validation',
		async (predicate) => {
			await expect(updateWithSql(predicate)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
			expect(mocks.validateWarehouseRowPredicate).not.toHaveBeenCalled();
			expect(mocks.updateUserGroup).not.toHaveBeenCalled();
		},
	);

	it('rejects full queries in manual SQL mode', async () => {
		mockOrdersRowSecurity();
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
		const identity = { ...ORDERS_POLICY_TABLE, access: 'predicate' };
		for (const policy of [
			{ ...identity, conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }] },
			{ ...identity, predicate: 'tenant_id = 7' },
		]) {
			await expect(
				caller.update({
					groupId: 'group-id',
					featureGrants: [],
					toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
					rowPolicies: { version: 1, policies: [policy] },
				} as never),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		}
		expect(mocks.updateUserGroup).not.toHaveBeenCalled();
	});

	it('rejects condition columns outside the table registry', async () => {
		mockOrdersRowSecurity();

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

		await expect(caller.overview()).resolves.toEqual({ users: [], groups: [], memberships: [] });
		expect(mocks.getUserGroupOverview).toHaveBeenCalledWith('project-id');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('requires a project admin', async () => {
		mocks.role = 'user';

		await expect(caller.overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns project-scoped effective OIDC env mappings to licensed admins', async () => {
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = 'finance:*:Analysts';
		mocks.listEffectiveOidcUserGroupMappings.mockResolvedValue([
			{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);

		await expect(caller.effectiveOidcEnvMappings()).resolves.toEqual([
			{ identifier: 'finance', targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);
		expect(mocks.hasFeature).toHaveBeenCalledWith('sso');
		expect(mocks.listEffectiveOidcUserGroupMappings).toHaveBeenCalledWith('project-id', [
			{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'analysts' },
		]);
	});

	it('fails safely when OIDC env mapping visibility is unavailable', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		await expect(caller.effectiveOidcEnvMappings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.listEffectiveOidcUserGroupMappings).not.toHaveBeenCalled();

		mocks.hasFeature.mockResolvedValue(true);
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = 'invalid';
		await expect(caller.effectiveOidcEnvMappings()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
		});
		expect(mocks.listEffectiveOidcUserGroupMappings).not.toHaveBeenCalled();

		mocks.role = 'user';
		mocks.env.OIDC_GROUP_NAO_GROUP_MAPPING = undefined;
		await expect(caller.effectiveOidcEnvMappings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.hasFeature).toHaveBeenCalledTimes(2);
	});

	it('returns project-scoped effective Entra env mappings to licensed admins', async () => {
		const groupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		mocks.env.AZURE_AD_GROUP_NAO_GROUP_MAPPING = `${groupId}:*:Analysts`;
		mocks.listEffectiveEntraUserGroupMappings.mockResolvedValue([
			{ identifier: groupId, targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);

		await expect(caller.effectiveMicrosoftEnvMappings()).resolves.toEqual([
			{ identifier: groupId, targetGroupId: 'analysts-id', targetGroupName: 'Analysts' },
		]);
		expect(mocks.listEffectiveEntraUserGroupMappings).toHaveBeenCalledWith('project-id', [
			{ entraGroupId: groupId, projectScope: '*', naoUserGroup: 'analysts' },
		]);
	});

	it('validates feature keys and creates a group with unlimited entitlement', async () => {
		await expect(caller.create({ name: 'Analysts', featureGrants: ['unknown'] as never })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});

		await caller.create({
			name: ' Analysts ',
			featureGrants: ['storyCreation', 'storyCreation'],
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
		});

		expect(mocks.hasFeature).toHaveBeenCalledWith('user-groups');
		expect(mocks.createUserGroupWithinLimit).not.toHaveBeenCalled();
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			['storyCreation'],
			COMPACT_DENSITY_POLICY,
			RESTRICTED_DATABASE_ACCESS,
			RESTRICTED_DOCS_ACCESS,
			undefined,
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('creates free custom groups through the atomic limit query', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(caller.create({ name: 'Group' })).resolves.toEqual({
			id: 'group-id',
			name: 'Analysts',
		});
		expect(mocks.createUserGroupWithinLimit).toHaveBeenCalledWith(
			3,
			'project-id',
			'Group',
			[],
			DETAILED_DENSITY_POLICY,
			RESTRICTED_DATABASE_ACCESS,
			RESTRICTED_DOCS_ACCESS,
			undefined,
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
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

		await expect(caller.create({ name: 'Fourth group' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Free projects can create up to 3 custom user groups. Enterprise enables unlimited groups.',
		});
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
		expect(mocks.createUserGroupWithinLimit).toHaveBeenCalledOnce();
	});

	it('normalizes provider-specific SSO mappings on create', async () => {
		await caller.create({
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
			DETAILED_DENSITY_POLICY,
			RESTRICTED_DATABASE_ACCESS,
			RESTRICTED_DOCS_ACCESS,
			{
				version: 1,
				providers: {
					oidc: ['finance', 'data'],
					microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
				},
				defaultProjectRole: 'context_admin',
			},
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('rejects invalid Microsoft Entra group object IDs', async () => {
		await expect(
			caller.create({
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
		await caller.create({
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
			DETAILED_DENSITY_POLICY,
			{
				mode: 'restricted',
				strict: false,
				grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
				patterns: [],
			},
			RESTRICTED_DOCS_ACCESS,
			undefined,
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('normalizes and persists patterns even when they have no current matches', async () => {
		await caller.create({
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
			DETAILED_DENSITY_POLICY,
			{ mode: 'restricted', strict: false, grants: [], patterns: ['future.*', 'sales.customer_*'] },
			RESTRICTED_DOCS_ACCESS,
			undefined,
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('bounds pattern count and length', async () => {
		await expect(
			caller.create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: Array.from({ length: 201 }, () => 'x') },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			caller.create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: ['x'.repeat(256)] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('rejects malformed docs grants and bounds their size', async () => {
		await expect(
			caller.create({
				name: 'Analysts',
				docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '../secret.md' }] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			caller.create({
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
		await caller.create({
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
			DETAILED_DENSITY_POLICY,
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
			undefined,
			undefined,
			EMPTY_FILES_CONTEXT_ACCESS,
			'inherit',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('rejects invalid density policies', async () => {
		await expect(
			caller.create({
				name: 'Analysts',
				featureGrants: [],
				toolCallDensityPolicy: {
					defaultDensity: 'condensed',
					canChange: true,
				},
			} as never),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			caller.create({
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
		await caller.update({
			groupId: 'group-id',
			name: 'Analysts',
			featureGrants: ['automationCreation'],
			toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: 'Analysts',
			featureGrants: ['automationCreation'],
			toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
		});
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('saves the project sharing permission and unshares project-wide content no longer allowed', async () => {
		await caller.update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
			projectSharing: 'blocked',
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith(
			'project-id',
			'group-id',
			expect.objectContaining({ projectSharing: 'blocked' }),
		);
		expect(mocks.revokeUnauthorizedProjectWideShares).toHaveBeenCalledWith('project-id');
	});

	it('unshares project-wide content no longer allowed after membership changes and group deletion', async () => {
		await caller.setMembership({ groupId: 'group-id', userId: 'target-user-id', isMember: false });
		expect(mocks.setUserGroupMembership).toHaveBeenCalled();
		expect(mocks.revokeUnauthorizedProjectWideShares).toHaveBeenCalledWith('project-id');

		mocks.revokeUnauthorizedProjectWideShares.mockClear();
		await caller.delete({ groupId: 'group-id' });
		expect(mocks.deleteUserGroup).toHaveBeenCalledWith('project-id', 'group-id');
		expect(mocks.revokeUnauthorizedProjectWideShares).toHaveBeenCalledWith('project-id');
	});

	it('creates groups with their project sharing permission', async () => {
		await caller.create({ name: 'Client A', projectSharing: 'blocked' });

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Client A',
			[],
			expect.anything(),
			expect.anything(),
			expect.anything(),
			undefined,
			undefined,
			expect.anything(),
			'blocked',
			EMPTY_MCP_ACCESS,
			false,
		);
	});

	it('previews the shares unshared by a project sharing change for admins only', async () => {
		mocks.previewProjectWideShareRevocation.mockResolvedValue({ chatCount: 2, storyCount: 1 });

		await expect(
			caller.previewProjectSharingRevocation({ groupId: 'group-id', projectSharing: 'blocked' }),
		).resolves.toEqual({ chatCount: 2, storyCount: 1 });
		expect(mocks.previewProjectWideShareRevocation).toHaveBeenCalledWith('project-id', 'group-id', 'blocked');

		mocks.role = 'user';
		await expect(
			caller.previewProjectSharingRevocation({ groupId: 'group-id', projectSharing: 'blocked' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('tells members whether they can share with the entire project', async () => {
		mocks.role = 'user';
		mocks.getShareAudience.mockResolvedValue({
			canShareToProject: false,
			memberIds: new Set(['user-id']),
			groupIds: new Set(['client-a']),
		});

		await expect(caller.projectSharingAccess()).resolves.toEqual({ canShareToProject: false });
		expect(mocks.getShareAudience).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('deletes groups and changes memberships without unlimited entitlement', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await caller.delete({ groupId: 'group-id' });
		await caller.setMembership({ groupId: 'group-id', userId: 'target-user-id', isMember: true });

		expect(mocks.deleteUserGroup).toHaveBeenCalledWith('project-id', 'group-id');
		expect(mocks.setUserGroupMembership).toHaveBeenCalledWith('project-id', 'group-id', 'target-user-id', true);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it.each([
		[
			'update',
			() =>
				caller.update({
					groupId: 'locked-id',
					featureGrants: [],
					toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
				}),
		],
		['delete', () => caller.delete({ groupId: 'locked-id' })],
		[
			'setMembership',
			() =>
				caller.setMembership({
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
		await caller.update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: undefined,
			featureGrants: [],
			toolCallDensityPolicy: DETAILED_DENSITY_POLICY,
		});
	});

	it('returns a fresh admin context catalog', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});

		await expect(caller.contextCatalog()).resolves.toEqual({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});
		expect(mocks.getDatabaseContextCatalog).toHaveBeenCalledWith('/project', { fresh: true });
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns an independent admin docs catalog', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getDocsContextCatalog.mockReturnValue({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});

		await expect(caller.docsContextCatalog()).resolves.toEqual({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});
		expect(mocks.getDocsContextCatalog).toHaveBeenCalledWith('/project');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns an independent admin project files catalog', async () => {
		mocks.hasFeature.mockResolvedValue(false);
		mocks.getFilesContextCatalog.mockReturnValue({
			syncState: 'ready',
			entries: [{ kind: 'folder', path: 'models' }],
		});

		await expect(caller.filesContextCatalog()).resolves.toEqual({
			syncState: 'ready',
			entries: [{ kind: 'folder', path: 'models' }],
		});
		expect(mocks.getFilesContextCatalog).toHaveBeenCalledWith('/project');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns effective access for a project user to admins', async () => {
		await expect(caller.effectiveAccessForUser({ userId: 'target-user-id' })).resolves.toEqual({
			features: {
				storyCreation: true,
				customStoryCreation: false,
				automationCreation: false,
			},
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
			canSeeAdvancedSettings: false,
			databaseAccess: RESTRICTED_DATABASE_ACCESS,
			docsAccess: RESTRICTED_DOCS_ACCESS,
			rowPolicies: [{ version: 1, policies: [] }],
		});
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'target-user-id');
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'target-user-id');
	});

	it('rejects effective access for a user outside the project', async () => {
		mocks.getUserRoleInProject.mockImplementation(async (_projectId, userId) =>
			userId === 'missing-user-id' ? null : mocks.role,
		);

		await expect(caller.effectiveAccessForUser({ userId: 'missing-user-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
			message: 'This user does not have access to the project.',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('requires an admin for arbitrary-user effective access', async () => {
		mocks.role = 'user';
		await expect(caller.effectiveAccessForUser({ userId: 'target-user-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});

		mocks.role = 'admin';
		mocks.hasFeature.mockResolvedValue(false);
		await expect(caller.effectiveAccessForUser({ userId: 'target-user-id' })).resolves.toBeDefined();
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('returns enforced effective access without unlimited entitlement', async () => {
		mocks.role = 'viewer';
		mocks.hasFeature.mockResolvedValue(false);

		await expect(caller.effectiveAccess()).resolves.toEqual({
			features: {
				storyCreation: true,
				customStoryCreation: false,
				automationCreation: false,
			},
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
			canSeeAdvancedSettings: false,
			databaseAccess: RESTRICTED_DATABASE_ACCESS,
			docsAccess: RESTRICTED_DOCS_ACCESS,
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});
});

describe('user group budget', () => {
	it('saves the budget of a new group with the group itself', async () => {
		await caller.create({ name: 'Analysts', budgetLimitUsd: 300 });

		expect(mocks.setGroupBudget).toHaveBeenCalledWith('project-id', 'group-id', 300);
	});

	it('leaves the group budget untouched when no limit is sent', async () => {
		await caller.update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
		});

		expect(mocks.setGroupBudget).not.toHaveBeenCalled();
	});

	it('rejects a group budget without the license before creating the group', async () => {
		mocks.hasFeature.mockImplementation(async (feature) => feature !== 'user-budget');

		await expect(caller.create({ name: 'Analysts', budgetLimitUsd: 300 })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
		expect(mocks.setGroupBudget).not.toHaveBeenCalled();
	});
});

function updateWithConditions(conditions: Array<{ column: string; operator: string; value?: string }>) {
	return caller.update({
		groupId: 'group-id',
		featureGrants: [],
		toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
		rowPolicies: {
			version: 1,
			policies: [
				{
					...ORDERS_POLICY_TABLE,
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
	return caller.update({
		groupId: 'group-id',
		featureGrants: [],
		toolCallDensityPolicy: COMPACT_DENSITY_POLICY,
		rowPolicies: {
			version: 1,
			policies: [
				{
					...ORDERS_POLICY_TABLE,
					access: 'predicate',
					mode: 'sql',
					predicate,
				},
			],
		},
	});
}

function mockOrdersRowSecurity(): void {
	mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [ORDERS_TABLE] });
}
