import { resolveWarehouseRowSecurity, type SsoGroupProvider } from '@nao/shared';
import type { UserRole } from '@nao/shared/types';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
});

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle(process.env.NAO_TEST_DATABASE_PATH ?? './db.sqlite', { schema }) };
});

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import {
	organization,
	orgMember,
	project,
	projectMember,
	user,
	userGroup,
	userGroupMember,
} from '../src/db/sqlite-schema';
import { createProject } from '../src/queries/project.queries';
import { reconcileSsoUserGroupMemberships } from '../src/queries/sso-user-group-membership.queries';
import {
	addUserGroupMemberships,
	countCustomUserGroups,
	createUserGroup,
	createUserGroupWithinLimit,
	deleteUserGroup,
	getUserGroupOverview,
	listUserGroupMemberships,
	listUserGroupSsoMemberships,
	resolveUserGroupAccess,
	setUserGroupMembership,
	updateProjectRowSecurity,
	updateUserGroup,
	validateAssignableUserGroupIds,
} from '../src/queries/user-group.queries';
import { addProjectMemberWithUserGroups } from '../src/services/project-user-group-membership.service';

const db = drizzle(process.env.NAO_TEST_DATABASE_PATH ?? './db.sqlite', { schema: sqliteSchema });
const PROJECT_ID = 'user-group-project';
const FOREIGN_PROJECT_ID = 'foreign-user-group-project';
const ORG_ID = 'user-group-org';
const DIRECT_USER_ID = 'user-group-direct';
const INHERITED_USER_ID = 'user-group-inherited';
const BOTH_USER_ID = 'user-group-both';
const OUTSIDER_USER_ID = 'user-group-outsider';
const DEFAULT_DENSITY = { defaultDensity: 'detailed', canChange: true } as const;

describe('user group queries', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values({ id: ORG_ID, name: 'User Group Org', slug: ORG_ID });
		await createProject({
			id: PROJECT_ID,
			orgId: ORG_ID,
			name: 'User Group Project',
			type: 'local',
			path: '/tmp/user-group-project',
		});
		await db.insert(project).values({
			id: FOREIGN_PROJECT_ID,
			orgId: ORG_ID,
			name: 'Foreign User Group Project',
			type: 'local',
			path: '/tmp/foreign-user-group-project',
		});
		await db.insert(user).values([
			{ id: DIRECT_USER_ID, name: 'Direct User', email: 'user-group-direct@example.com' },
			{ id: INHERITED_USER_ID, name: 'Inherited User', email: 'user-group-inherited@example.com' },
			{ id: BOTH_USER_ID, name: 'Both User', email: 'user-group-both@example.com' },
			{ id: OUTSIDER_USER_ID, name: 'Outsider User', email: 'user-group-outsider@example.com' },
		]);
		await db.insert(projectMember).values([
			{ projectId: PROJECT_ID, userId: DIRECT_USER_ID, role: 'admin' },
			{ projectId: PROJECT_ID, userId: BOTH_USER_ID, role: 'viewer' },
		]);
		await db.insert(orgMember).values([
			{ orgId: ORG_ID, userId: INHERITED_USER_ID, role: 'user' },
			{ orgId: ORG_ID, userId: BOTH_USER_ID, role: 'admin' },
		]);
	});

	afterEach(cleanup);

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('creates an editable All Users group with every effective project user and feature', async () => {
		const [storedDefaultGroup] = await db.select().from(userGroup).where(eq(userGroup.projectId, PROJECT_ID));
		expect(storedDefaultGroup).toMatchObject({
			name: 'All Users',
			isDefault: true,
			featureGrants: {
				version: 2,
				features: ['storyCreation', 'automationCreation'],
				toolCallDensity: {
					defaultDensity: 'detailed',
					canChange: true,
				},
			},
			contextGrants: {
				version: 4,
				databaseAccess: { mode: 'all', strict: true },
				docsAccess: { mode: 'all' },
			},
		});

		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups.find((group) => group.isDefault);

		expect(defaultGroup).toMatchObject({
			name: 'All Users',
			featureGrants: ['storyCreation', 'automationCreation'],
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
		expect(defaultGroup).not.toHaveProperty('contextGrants');
		expect(overview.users.map(({ id }) => id).sort()).toEqual(
			[BOTH_USER_ID, DIRECT_USER_ID, INHERITED_USER_ID].sort(),
		);
		expect(overview.users.find(({ id }) => id === DIRECT_USER_ID)).toMatchObject({
			role: 'admin',
			source: 'project',
		});
		expect(overview.users.find(({ id }) => id === INHERITED_USER_ID)).toMatchObject({
			role: 'user',
			source: 'organization',
		});
		expect(overview.users.find(({ id }) => id === BOTH_USER_ID)).toMatchObject({
			role: 'viewer',
			source: 'both',
		});
		expect(overview.memberships.filter(({ groupId }) => groupId === defaultGroup?.id)).toHaveLength(3);
		expect(await getUserGroupOverview(PROJECT_ID)).toMatchObject({
			groups: [expect.objectContaining({ isDefault: true })],
		});
		await expect(
			updateUserGroup(PROJECT_ID, defaultGroup?.id ?? '', { featureGrants: ['automationCreation'] }),
		).resolves.toMatchObject({
			featureGrants: ['automationCreation'],
		});
	});

	it('loads the overview with legacy raw predicate policies as no policy', async () => {
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		await db
			.update(userGroup)
			.set({
				rowPolicies: {
					version: 1,
					policies: [
						{
							databaseType: 'duckdb',
							database: 'sales',
							schema: 'main',
							table: 'orders',
							access: 'predicate',
							predicate: 'tenant_id = 7',
						},
					],
				},
			})
			.where(eq(userGroup.id, analysts.id));

		const overview = await getUserGroupOverview(PROJECT_ID);

		expect(overview.groups.find((group) => group.id === analysts.id)?.rowPolicies).toEqual({
			version: 1,
			policies: [],
		});
	});

	it('loads the overview with legacy guided policies migrated to AND', async () => {
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		await db
			.update(userGroup)
			.set({
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
			})
			.where(eq(userGroup.id, analysts.id));

		const overview = await getUserGroupOverview(PROJECT_ID);

		expect(overview.groups.find((group) => group.id === analysts.id)?.rowPolicies).toEqual({
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
					conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
				},
			],
		});
	});

	it('prunes row policies outside Context when creating a group', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
		};
		const customers = { ...orders, table: 'customers' };

		const group = await createUserGroup(
			PROJECT_ID,
			'Analysts',
			[],
			DEFAULT_DENSITY,
			{
				mode: 'restricted',
				strict: true,
				grants: [{ kind: 'table', ...orders }],
				patterns: [],
			},
			undefined,
			undefined,
			{
				version: 1,
				policies: [
					{ ...customers, access: 'full' },
					{ ...orders, access: 'full' },
				],
			},
		);

		expect(group.rowPolicies).toEqual({ version: 1, policies: [{ ...orders, access: 'full' }] });
		const [stored] = await db
			.select({ rowPolicies: userGroup.rowPolicies })
			.from(userGroup)
			.where(eq(userGroup.id, group.id));
		expect(stored.rowPolicies).toEqual({ version: 1, policies: [{ ...orders, access: 'full' }] });
	});

	it('prunes persisted row policies when Context access is narrowed', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
		};
		const customers = { ...orders, table: 'customers' };
		const group = await createUserGroup(
			PROJECT_ID,
			'Analysts',
			[],
			DEFAULT_DENSITY,
			{ mode: 'all', strict: true },
			undefined,
			undefined,
			{
				version: 1,
				policies: [
					{ ...customers, access: 'full' },
					{ ...orders, access: 'full' },
				],
			},
		);

		const updated = await updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			databaseAccess: {
				mode: 'restricted',
				strict: true,
				grants: [{ kind: 'table', ...orders }],
				patterns: [],
			},
		});

		expect(updated.rowPolicies).toEqual({ version: 1, policies: [{ ...orders, access: 'full' }] });
		const [stored] = await db
			.select({ rowPolicies: userGroup.rowPolicies })
			.from(userGroup)
			.where(eq(userGroup.id, group.id));
		expect(stored.rowPolicies).toEqual({ version: 1, policies: [{ ...orders, access: 'full' }] });
	});

	it('keeps row policies granted by a dynamic Context pattern', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
		};
		const group = await createUserGroup(
			PROJECT_ID,
			'Analysts',
			[],
			DEFAULT_DENSITY,
			{ mode: 'restricted', strict: true, grants: [], patterns: ['main.ord*'] },
			undefined,
			undefined,
			{ version: 1, policies: [{ ...orders, access: 'full' }] },
		);

		expect(group.rowPolicies).toEqual({ version: 1, policies: [{ ...orders, access: 'full' }] });
	});

	it('filters each group row policy against that same group Context access', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
		};
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, {
			featureGrants: overview.groups[0].featureGrants,
			databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
		});
		const contextGroup = await createUserGroup(
			PROJECT_ID,
			'Context group',
			[],
			DEFAULT_DENSITY,
			{
				mode: 'restricted',
				strict: true,
				grants: [{ kind: 'table', ...orders }],
				patterns: [],
			},
			undefined,
			undefined,
			{
				version: 1,
				policies: [
					{
						...orders,
						access: 'predicate',
						mode: 'sql',
						predicate: 'WHERE tenant_id = 7',
					},
				],
			},
		);
		const nonContextGroup = await createUserGroup(PROJECT_ID, 'Non-Context group');
		await db
			.update(userGroup)
			.set({ rowPolicies: { version: 1, policies: [{ ...orders, access: 'full' }] } })
			.where(eq(userGroup.id, nonContextGroup.id));
		await setUserGroupMembership(PROJECT_ID, contextGroup.id, DIRECT_USER_ID, true);
		await setUserGroupMembership(PROJECT_ID, nonContextGroup.id, DIRECT_USER_ID, true);

		let access = await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID);
		expect(access.databaseAccess).toMatchObject({ mode: 'restricted', grants: [{ kind: 'table', ...orders }] });
		expect(
			resolveWarehouseRowSecurity(
				{ version: 1, tables: [{ ...orders, constraintColumns: ['tenant_id'] }] },
				access.rowPolicies,
			),
		).toEqual({
			enforced: true,
			tables: [
				{
					...orders,
					constraintColumns: ['tenant_id'],
					access: 'predicate',
					predicate: '(tenant_id = 7)',
				},
			],
		});

		await updateUserGroup(PROJECT_ID, contextGroup.id, {
			featureGrants: [],
			rowPolicies: { version: 1, policies: [] },
		});
		access = await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID);
		expect(
			resolveWarehouseRowSecurity(
				{ version: 1, tables: [{ ...orders, constraintColumns: ['tenant_id'] }] },
				access.rowPolicies,
			),
		).toEqual({
			enforced: true,
			tables: [{ ...orders, constraintColumns: ['tenant_id'], access: 'none' }],
		});
	});

	it('prunes removed-table row policies and preserves policies for registered tables', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
			constraintColumns: ['tenant_id'],
		};
		const customers = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'customers',
			constraintColumns: ['region'],
		};
		await updateProjectRowSecurity(PROJECT_ID, { version: 1, tables: [orders, customers] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', [], DEFAULT_DENSITY, {
			mode: 'all',
			strict: true,
		});
		const support = await createUserGroup(PROJECT_ID, 'Support', [], DEFAULT_DENSITY, {
			mode: 'all',
			strict: true,
		});
		await updateUserGroup(PROJECT_ID, analysts.id, {
			featureGrants: [],
			rowPolicies: {
				version: 1,
				policies: [
					{
						databaseType: orders.databaseType,
						database: orders.database,
						schema: orders.schema,
						table: orders.table,
						access: 'predicate',
						mode: 'guided',
						combinator: 'and',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
					{
						databaseType: customers.databaseType,
						database: customers.database,
						schema: customers.schema,
						table: customers.table,
						access: 'full',
					},
				],
			},
		});
		await updateUserGroup(PROJECT_ID, support.id, {
			featureGrants: [],
			rowPolicies: {
				version: 1,
				policies: [
					{
						databaseType: customers.databaseType,
						database: customers.database,
						schema: customers.schema,
						table: customers.table,
						access: 'full',
					},
				],
			},
		});

		await updateProjectRowSecurity(PROJECT_ID, { version: 1, tables: [orders] });

		const groups = await getUserGroupOverview(PROJECT_ID);
		const updatedAnalysts = groups.groups.find((group) => group.id === analysts.id);
		const updatedSupport = groups.groups.find((group) => group.id === support.id);
		expect(updatedAnalysts).toBeDefined();
		expect(updatedAnalysts?.rowPolicies).toEqual({
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
					conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
				},
			],
		});
		expect(updatedSupport?.rowPolicies).toEqual({ version: 1, policies: [] });
		await expect(
			updateUserGroup(PROJECT_ID, analysts.id, {
				featureGrants: ['storyCreation'],
				rowPolicies: updatedAnalysts!.rowPolicies,
			}),
		).resolves.toMatchObject({ featureGrants: ['storyCreation'] });
	});

	it('prunes policies affected by constraint column changes and preserves unaffected guided policies', async () => {
		const orders = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
			constraintColumns: ['tenant_id', 'region'],
		};
		const customers = { ...orders, table: 'customers' };
		const invoices = { ...orders, table: 'invoices' };
		await updateProjectRowSecurity(PROJECT_ID, { version: 1, tables: [orders, customers, invoices] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', [], DEFAULT_DENSITY, {
			mode: 'all',
			strict: true,
		});
		await updateUserGroup(PROJECT_ID, analysts.id, {
			featureGrants: [],
			rowPolicies: {
				version: 1,
				policies: [
					{
						databaseType: orders.databaseType,
						database: orders.database,
						schema: orders.schema,
						table: orders.table,
						access: 'predicate',
						mode: 'guided',
						combinator: 'and',
						conditions: [{ column: 'region', operator: 'equals', value: 'west' }],
					},
					{
						databaseType: customers.databaseType,
						database: customers.database,
						schema: customers.schema,
						table: customers.table,
						access: 'predicate',
						mode: 'guided',
						combinator: 'and',
						conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
					},
					{
						databaseType: invoices.databaseType,
						database: invoices.database,
						schema: invoices.schema,
						table: invoices.table,
						access: 'predicate',
						mode: 'sql',
						predicate: 'WHERE tenant_id = 7',
					},
				],
			},
		});

		await updateProjectRowSecurity(PROJECT_ID, {
			version: 1,
			tables: [orders, customers, invoices].map((table) => ({
				...table,
				constraintColumns: ['tenant_id'],
			})),
		});

		const groups = await getUserGroupOverview(PROJECT_ID);
		expect(groups.groups.find((group) => group.id === analysts.id)?.rowPolicies.policies).toEqual([
			{
				databaseType: 'duckdb',
				database: 'sales',
				schema: 'main',
				table: 'customers',
				access: 'predicate',
				mode: 'guided',
				combinator: 'and',
				conditions: [{ column: 'tenant_id', operator: 'equals', value: '7' }],
			},
		]);
	});

	it('preserves manual SQL policies for additions and prunes them after a constraint column removal', async () => {
		const table = {
			databaseType: 'duckdb',
			database: 'sales',
			schema: 'main',
			table: 'orders',
			constraintColumns: ['tenant_id'],
		};
		await updateProjectRowSecurity(PROJECT_ID, { version: 1, tables: [table] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', [], DEFAULT_DENSITY, {
			mode: 'all',
			strict: true,
		});
		await updateUserGroup(PROJECT_ID, analysts.id, {
			featureGrants: [],
			rowPolicies: {
				version: 1,
				policies: [
					{
						databaseType: table.databaseType,
						database: table.database,
						schema: table.schema,
						table: table.table,
						access: 'predicate',
						mode: 'sql',
						predicate: 'WHERE tenant_id = 7',
					},
				],
			},
		});

		await updateProjectRowSecurity(PROJECT_ID, {
			version: 1,
			tables: [{ ...table, constraintColumns: ['tenant_id', 'region'] }],
		});
		let group = (await getUserGroupOverview(PROJECT_ID)).groups.find(({ id }) => id === analysts.id);
		expect(group?.rowPolicies.policies).toEqual([
			expect.objectContaining({ mode: 'sql', predicate: 'WHERE tenant_id = 7' }),
		]);

		await updateProjectRowSecurity(PROJECT_ID, { version: 1, tables: [table] });
		group = (await getUserGroupOverview(PROJECT_ID)).groups.find(({ id }) => id === analysts.id);
		expect(group?.rowPolicies.policies).toEqual([]);
	});

	it('does not write when reading a project without user groups', async () => {
		await db.delete(userGroup).where(eq(userGroup.projectId, PROJECT_ID));

		await expect(getUserGroupOverview(PROJECT_ID)).resolves.toMatchObject({ groups: [] });
		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([]);
		await expect(db.select().from(userGroup).where(eq(userGroup.projectId, PROJECT_ID))).resolves.toHaveLength(0);
	});

	it('counts only custom groups in the selected project', async () => {
		await getUserGroupOverview(PROJECT_ID);
		expect(await countCustomUserGroups(PROJECT_ID)).toBe(0);

		await createUserGroup(PROJECT_ID, 'Analysts');
		await createUserGroup(PROJECT_ID, 'Finance');
		await createUserGroup(FOREIGN_PROJECT_ID, 'Foreign Analysts');

		expect(await countCustomUserGroups(PROJECT_ID)).toBe(2);
	});

	it('supports group CRUD and validates membership and default-group rules', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		const group = await createUserGroup(PROJECT_ID, 'Analysts');

		expect(group.featureGrants).toEqual([]);
		expect(group.databaseAccess).toEqual({ mode: 'restricted', strict: true, grants: [], patterns: [] });
		expect(group.docsAccess).toEqual({ mode: 'restricted', grants: [] });
		expect(group.toolCallDensityPolicy).toEqual({
			defaultDensity: 'detailed',
			canChange: true,
		});
		await setUserGroupMembership(PROJECT_ID, group.id, INHERITED_USER_ID, true);
		expect((await getUserGroupOverview(PROJECT_ID)).memberships).toContainEqual({
			groupId: group.id,
			userId: INHERITED_USER_ID,
		});

		const updated = await updateUserGroup(PROJECT_ID, group.id, {
			name: 'Data Analysts',
			featureGrants: ['storyCreation'],
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [
					{
						kind: 'table',
						databaseType: 'POSTGRES',
						database: 'app',
						schema: 'public',
						table: 'users',
					},
				],
				patterns: [' Public.User* ', 'public.user*'],
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		expect(updated).toMatchObject({
			name: 'Data Analysts',
			featureGrants: ['storyCreation'],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'users',
					},
				],
				patterns: ['public.user*'],
			},
		});
		const [storedUpdated] = await db
			.select({ contextGrants: userGroup.contextGrants, featureGrants: userGroup.featureGrants })
			.from(userGroup)
			.where(eq(userGroup.id, group.id));
		expect(storedUpdated.featureGrants).toEqual({
			version: 2,
			features: ['storyCreation'],
			toolCallDensity: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		expect(storedUpdated.contextGrants).toEqual({
			version: 4,
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'users',
					},
				],
				patterns: ['public.user*'],
			},
			docsAccess: { mode: 'restricted', grants: [] },
		});

		await updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			toolCallDensityPolicy: DEFAULT_DENSITY,
		});
		await updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		});
		const updatedOverviewGroup = (await getUserGroupOverview(PROJECT_ID)).groups.find(({ id }) => id === group.id);
		expect(updatedOverviewGroup?.databaseAccess).toEqual(updated.databaseAccess);
		expect(updatedOverviewGroup?.docsAccess).toEqual({
			mode: 'restricted',
			grants: [{ kind: 'folder', path: 'finance' }],
		});

		await expect(setUserGroupMembership(PROJECT_ID, group.id, OUTSIDER_USER_ID, true)).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		await expect(setUserGroupMembership(PROJECT_ID, defaultGroup.id, DIRECT_USER_ID, false)).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		await expect(
			updateUserGroup(PROJECT_ID, defaultGroup.id, { name: 'Everyone', featureGrants: [] }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(deleteUserGroup(PROJECT_ID, defaultGroup.id)).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});

		await updateUserGroup(PROJECT_ID, defaultGroup.id, { featureGrants: ['automationCreation'] });
		await deleteUserGroup(PROJECT_ID, group.id);
		expect((await getUserGroupOverview(PROJECT_ID)).groups).toHaveLength(1);
	});

	it('translates concurrent create name conflicts', async () => {
		const results = await Promise.allSettled([
			createUserGroup(PROJECT_ID, 'Analysts'),
			createUserGroup(PROJECT_ID, 'Analysts'),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('translates concurrent case-only create name conflicts', async () => {
		const results = await Promise.allSettled([
			createUserGroup(PROJECT_ID, 'Finance'),
			createUserGroup(PROJECT_ID, 'finance'),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('serializes concurrent Unicode case-only unlimited creates', async () => {
		const results = await Promise.allSettled([
			createUserGroup(PROJECT_ID, 'Équipe'),
			createUserGroup(PROJECT_ID, 'équipe'),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('serializes concurrent Unicode case-only free-limit creates', async () => {
		const results = await Promise.allSettled([
			createUserGroupWithinLimit(3, PROJECT_ID, 'Équipe'),
			createUserGroupWithinLimit(3, PROJECT_ID, 'équipe'),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
		expect(await countCustomUserGroups(PROJECT_ID)).toBe(1);
	});

	it('rejects sequential exact and case-only create name conflicts', async () => {
		await createUserGroup(PROJECT_ID, 'Finance');

		await expect(createUserGroup(PROJECT_ID, 'Finance')).rejects.toMatchObject({
			code: 'CONFLICT',
			message: 'A user group with this name already exists.',
		});
		await expect(createUserGroup(PROJECT_ID, 'finance')).rejects.toMatchObject({
			code: 'CONFLICT',
			message: 'A user group with this name already exists.',
		});
	});

	it('translates concurrent rename name conflicts', async () => {
		const firstGroup = await createUserGroup(PROJECT_ID, 'First');
		const secondGroup = await createUserGroup(PROJECT_ID, 'Second');
		const results = await Promise.allSettled([
			updateUserGroup(PROJECT_ID, firstGroup.id, { name: 'Analysts', featureGrants: [] }),
			updateUserGroup(PROJECT_ID, secondGroup.id, { name: 'Analysts', featureGrants: [] }),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('translates concurrent case-only rename name conflicts', async () => {
		const firstGroup = await createUserGroup(PROJECT_ID, 'First');
		const secondGroup = await createUserGroup(PROJECT_ID, 'Second');
		const results = await Promise.allSettled([
			updateUserGroup(PROJECT_ID, firstGroup.id, { name: 'Analysts', featureGrants: [] }),
			updateUserGroup(PROJECT_ID, secondGroup.id, { name: 'analysts', featureGrants: [] }),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('serializes concurrent Unicode case-only renames', async () => {
		const firstGroup = await createUserGroup(PROJECT_ID, 'First');
		const secondGroup = await createUserGroup(PROJECT_ID, 'Second');
		const results = await Promise.allSettled([
			updateUserGroup(PROJECT_ID, firstGroup.id, { name: 'Équipe', featureGrants: [] }),
			updateUserGroup(PROJECT_ID, secondGroup.id, { name: 'équipe', featureGrants: [] }),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'CONFLICT',
				message: 'A user group with this name already exists.',
			},
		});
	});

	it('rejects case-only rename conflicts while allowing case-only self-renames', async () => {
		const finance = await createUserGroup(PROJECT_ID, 'Finance');
		const marketing = await createUserGroup(PROJECT_ID, 'Marketing');

		await expect(
			updateUserGroup(PROJECT_ID, finance.id, { name: 'finance', featureGrants: [] }),
		).resolves.toMatchObject({
			id: finance.id,
			name: 'finance',
		});
		await expect(
			updateUserGroup(PROJECT_ID, marketing.id, { name: 'FINANCE', featureGrants: [] }),
		).rejects.toMatchObject({
			code: 'CONFLICT',
			message: 'A user group with this name already exists.',
		});
	});

	it('validates assignable groups and inserts memberships idempotently', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		const foreignGroup = await createUserGroup(FOREIGN_PROJECT_ID, 'Foreign Analysts');

		await expect(validateAssignableUserGroupIds(PROJECT_ID, [analysts.id, analysts.id])).resolves.toEqual([
			analysts.id,
		]);
		await expect(validateAssignableUserGroupIds(PROJECT_ID, ['missing-group'])).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		await expect(validateAssignableUserGroupIds(PROJECT_ID, [foreignGroup.id])).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		await expect(validateAssignableUserGroupIds(PROJECT_ID, [overview.groups[0].id])).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});

		await addUserGroupMemberships([analysts.id, analysts.id], DIRECT_USER_ID);
		await addUserGroupMemberships([analysts.id], DIRECT_USER_ID);
		expect(
			(await listUserGroupMemberships(PROJECT_ID)).filter(
				({ groupId, userId }) => groupId === analysts.id && userId === DIRECT_USER_ID,
			),
		).toHaveLength(1);
	});

	it('rolls back project membership when a group membership insert fails', async () => {
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		db.$client.exec('DROP TRIGGER IF EXISTS fail_user_group_membership_insert');
		db.$client.exec(`
			CREATE TRIGGER fail_user_group_membership_insert
			BEFORE INSERT ON user_group_member
			BEGIN
				SELECT RAISE(ABORT, 'forced membership insert failure');
			END
		`);

		try {
			await expect(
				addProjectMemberWithUserGroups({ projectId: PROJECT_ID, userId: OUTSIDER_USER_ID, role: 'user' }, [
					analysts.id,
				]),
			).rejects.toThrow('forced membership insert failure');
			expect(
				await db.select().from(projectMember).where(eq(projectMember.userId, OUTSIDER_USER_ID)).execute(),
			).toHaveLength(0);
		} finally {
			db.$client.exec('DROP TRIGGER IF EXISTS fail_user_group_membership_insert');
		}
	});

	it('allows only one concurrent free-group creation at the limit', async () => {
		await createUserGroup(PROJECT_ID, 'First');
		await createUserGroup(PROJECT_ID, 'Second');

		const results = await Promise.allSettled([
			createUserGroupWithinLimit(3, PROJECT_ID, 'Third'),
			createUserGroupWithinLimit(3, PROJECT_ID, 'Fourth'),
		]);

		expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
			reason: {
				code: 'FORBIDDEN',
				message: 'Free projects can create up to 3 custom user groups. Enterprise enables unlimited groups.',
			},
		});
		expect(await countCustomUserGroups(PROJECT_ID)).toBe(3);
	});

	it('resolves every feature for an untouched project', async () => {
		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'storyCreation',
			'automationCreation',
		]);
	});

	it('unions grants from the default and explicit groups', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['storyCreation'] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['automationCreation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'storyCreation',
			'automationCreation',
		]);
	});

	it('excludes suspended groups from every effective access field without changing stored data', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		await updateUserGroup(PROJECT_ID, defaultGroup.id, {
			featureGrants: [],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: false },
			databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		const activeGroups = await Promise.all(
			['First', 'Second', 'Third'].map((name) =>
				createUserGroup(PROJECT_ID, name, [], { defaultDensity: 'detailed', canChange: false }),
			),
		);
		const suspendedGroup = await createUserGroup(
			PROJECT_ID,
			'Suspended',
			['automationCreation'],
			{ defaultDensity: 'compact', canChange: true },
			{ mode: 'all', strict: false },
			{ mode: 'all' },
		);
		for (const group of [...activeGroups, suspendedGroup]) {
			await setUserGroupMembership(PROJECT_ID, group.id, DIRECT_USER_ID, true);
		}

		const activeGroupIds = new Set([defaultGroup.id, ...activeGroups.map((group) => group.id)]);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID, activeGroupIds)).resolves.toEqual({
			groupNames: ['All Users', 'First', 'Second', 'Third'],
			features: [],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: false },
			databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
			rowPolicies: [
				{ version: 1, policies: [] },
				{ version: 1, policies: [] },
				{ version: 1, policies: [] },
				{ version: 1, policies: [] },
			],
		});

		expect(await listUserGroupMemberships(PROJECT_ID)).toContainEqual({
			groupId: suspendedGroup.id,
			userId: DIRECT_USER_ID,
		});
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			groupNames: expect.arrayContaining(['Suspended']),
			features: ['automationCreation'],
			toolCallDensityPolicy: { canChange: true },
			databaseAccess: { mode: 'all' },
			docsAccess: { mode: 'all' },
		});
	});

	it('unions database grants and lets all access dominate', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		await updateUserGroup(PROJECT_ID, defaultGroup.id, {
			featureGrants: defaultGroup.featureGrants,
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: ['main.*'] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'legal/terms.md' }] },
		});
		const analysts = await createUserGroup(
			PROJECT_ID,
			'Analysts',
			[],
			DEFAULT_DENSITY,
			{
				mode: 'restricted',
				strict: true,
				grants: [
					{ kind: 'schema', databaseType: 'POSTGRES', database: 'app', schema: 'analytics' },
					{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
				],
				patterns: ['sales.*'],
			},
			{ mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			databaseAccess: {
				mode: 'restricted',
				strict: true,
				grants: [
					{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'analytics' },
					{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
				],
				patterns: ['main.*', 'sales.*'],
			},
			docsAccess: {
				mode: 'restricted',
				grants: [
					{ kind: 'folder', path: 'finance' },
					{ kind: 'file', path: 'legal/terms.md' },
				],
			},
		});

		await updateUserGroup(PROJECT_ID, defaultGroup.id, {
			featureGrants: defaultGroup.featureGrants,
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: { mode: 'all' },
		});
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
		});
	});

	it('uses null defaults and fails malformed stored access closed', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		const customGroup = await createUserGroup(PROJECT_ID, 'Custom');
		await db.update(userGroup).set({ contextGrants: null }).where(eq(userGroup.id, defaultGroup.id));
		await db.update(userGroup).set({ contextGrants: null }).where(eq(userGroup.id, customGroup.id));

		let groups = (await getUserGroupOverview(PROJECT_ID)).groups;
		expect(groups.find(({ id }) => id === defaultGroup.id)?.databaseAccess).toEqual({
			mode: 'all',
			strict: true,
		});
		expect(groups.find(({ id }) => id === defaultGroup.id)?.docsAccess).toEqual({ mode: 'all' });
		expect(groups.find(({ id }) => id === customGroup.id)?.databaseAccess).toEqual({
			mode: 'restricted',
			strict: true,
			grants: [],
			patterns: [],
		});
		expect(groups.find(({ id }) => id === customGroup.id)?.docsAccess).toEqual({
			mode: 'restricted',
			grants: [],
		});

		await db
			.update(userGroup)
			.set({ contextGrants: { version: 1, access: { mode: 'broken' } } as never })
			.where(eq(userGroup.id, defaultGroup.id));
		groups = (await getUserGroupOverview(PROJECT_ID)).groups;
		expect(groups.find(({ id }) => id === defaultGroup.id)?.databaseAccess).toEqual({
			mode: 'restricted',
			strict: true,
			grants: [],
			patterns: [],
		});
	});

	it('normalizes v1 migration grants without exposing stored context grants', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		const customGroup = await createUserGroup(PROJECT_ID, 'Custom');
		await db
			.update(userGroup)
			.set({ contextGrants: { version: 1, access: { mode: 'all' } } })
			.where(eq(userGroup.id, defaultGroup.id));
		await db
			.update(userGroup)
			.set({ contextGrants: { version: 1, access: { mode: 'restricted', grants: [] } } })
			.where(eq(userGroup.id, customGroup.id));

		const groups = (await getUserGroupOverview(PROJECT_ID)).groups;
		const normalizedDefaultGroup = groups.find(({ id }) => id === defaultGroup.id);
		const normalizedCustomGroup = groups.find(({ id }) => id === customGroup.id);

		expect(normalizedDefaultGroup).toMatchObject({
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
		});
		expect(normalizedCustomGroup).toMatchObject({
			databaseAccess: { mode: 'restricted', strict: true, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(normalizedDefaultGroup).not.toHaveProperty('contextGrants');
		expect(normalizedCustomGroup).not.toHaveProperty('contextGrants');
	});

	it('uses a custom group when the default has no grants', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: [] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['storyCreation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual(['storyCreation']);
	});

	it('deduplicates grants shared by multiple groups', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['storyCreation'] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['storyCreation', 'automationCreation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'storyCreation',
			'automationCreation',
		]);
	});

	it('normalizes and deduplicates legacy creation grants in effective features and overview output', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		const defaultGroup = overview.groups[0];
		await db
			.update(userGroup)
			.set({
				featureGrants: [
					'stories',
					'storyCreation',
					'stories',
					'automations',
					'automationCreation',
					'automations',
				] as never,
			})
			.where(eq(userGroup.id, defaultGroup.id));

		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'storyCreation',
			'automationCreation',
		]);
		await expect(getUserGroupOverview(PROJECT_ID)).resolves.toMatchObject({
			groups: [
				expect.objectContaining({
					featureGrants: ['storyCreation', 'automationCreation'],
					toolCallDensityPolicy: {
						defaultDensity: 'detailed',
						canChange: false,
					},
				}),
			],
		});
	});

	it('only uses the default group without explicit memberships', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['automationCreation'] });
		await createUserGroup(PROJECT_ID, 'Analysts', ['storyCreation']);

		expect((await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual(['automationCreation']);
	});

	it('resolves effective names from All Users, manual, and SSO memberships within the project', async () => {
		const finance = await createUserGroup(PROJECT_ID, 'Finance');
		const marketing = await createUserGroup(PROJECT_ID, 'Marketing');
		const foreign = await createUserGroup(FOREIGN_PROJECT_ID, 'Foreign');
		await setUserGroupMembership(PROJECT_ID, finance.id, DIRECT_USER_ID, true);
		await db.insert(userGroupMember).values([
			{ groupId: marketing.id, userId: DIRECT_USER_ID, provider: 'oidc' },
			{ groupId: foreign.id, userId: DIRECT_USER_ID, provider: 'oidc' },
		]);

		const access = await resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID);

		expect(access.groupNames).toHaveLength(3);
		expect(access.groupNames).toEqual(expect.arrayContaining(['All Users', 'Finance', 'Marketing']));
		expect(access.groupNames).not.toContain('Foreign');
	});

	it('uses the All Users density policy without explicit memberships', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, {
			featureGrants: overview.groups[0].featureGrants,
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('uses the newest explicit membership for the density default', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, {
			featureGrants: overview.groups[0].featureGrants,
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
		const olderGroup = await createUserGroup(PROJECT_ID, 'Older', [], {
			defaultDensity: 'detailed',
			canChange: false,
		});
		const newerGroup = await createUserGroup(PROJECT_ID, 'Newer', [], {
			defaultDensity: 'compact',
			canChange: false,
		});
		await db.insert(userGroupMember).values([
			{ groupId: olderGroup.id, userId: DIRECT_USER_ID, createdAt: new Date('2025-01-01T00:00:00Z') },
			{ groupId: newerGroup.id, userId: DIRECT_USER_ID, createdAt: new Date('2025-01-02T00:00:00Z') },
		]);

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('uses a stable group-id tie break for equal membership timestamps', async () => {
		const firstGroup = await createUserGroup(PROJECT_ID, 'First');
		const secondGroup = await createUserGroup(PROJECT_ID, 'Second');
		const [winningGroup, losingGroup] = [firstGroup, secondGroup].sort((left, right) =>
			left.id.localeCompare(right.id),
		);
		await updateUserGroup(PROJECT_ID, winningGroup.id, {
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		await updateUserGroup(PROJECT_ID, losingGroup.id, {
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
		const createdAt = new Date('2025-01-01T00:00:00Z');
		await db.insert(userGroupMember).values([
			{ groupId: firstGroup.id, userId: DIRECT_USER_ID, createdAt },
			{ groupId: secondGroup.id, userId: DIRECT_USER_ID, createdAt },
		]);

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
			},
		});
	});

	it('unlocks when any applicable group allows changes', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, {
			featureGrants: overview.groups[0].featureGrants,
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
		const lockedGroup = await createUserGroup(PROJECT_ID, 'Locked', [], {
			defaultDensity: 'compact',
			canChange: false,
		});
		await setUserGroupMembership(PROJECT_ID, lockedGroup.id, DIRECT_USER_ID, true);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				canChange: false,
			},
		});

		const unlockedGroup = await createUserGroup(PROJECT_ID, 'Unlocked', [], {
			defaultDensity: 'detailed',
			canChange: true,
		});
		await setUserGroupMembership(PROJECT_ID, unlockedGroup.id, DIRECT_USER_ID, true);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				canChange: true,
			},
		});
	});

	it('keeps users unlocked when All Users allows changes', async () => {
		const lockedGroup = await createUserGroup(PROJECT_ID, 'Locked', [], {
			defaultDensity: 'compact',
			canChange: false,
		});
		await setUserGroupMembership(PROJECT_ID, lockedGroup.id, DIRECT_USER_ID, true);

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				canChange: true,
			},
		});
	});

	it('makes a removed and re-added membership the newest density default', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, {
			featureGrants: overview.groups[0].featureGrants,
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: false,
			},
		});
		const compactGroup = await createUserGroup(PROJECT_ID, 'Compact', [], {
			defaultDensity: 'compact',
			canChange: false,
		});
		const detailedGroup = await createUserGroup(PROJECT_ID, 'Detailed', [], {
			defaultDensity: 'detailed',
			canChange: false,
		});
		await setUserGroupMembership(PROJECT_ID, compactGroup.id, DIRECT_USER_ID, true);
		await db
			.update(userGroupMember)
			.set({ createdAt: new Date('2025-01-01T00:00:00Z') })
			.where(eq(userGroupMember.groupId, compactGroup.id));
		await setUserGroupMembership(PROJECT_ID, detailedGroup.id, DIRECT_USER_ID, true);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
			},
		});

		await setUserGroupMembership(PROJECT_ID, compactGroup.id, DIRECT_USER_ID, false);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await setUserGroupMembership(PROJECT_ID, compactGroup.id, DIRECT_USER_ID, true);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
			},
		});
	});

	it('preserves unchanged SSO membership timestamps and density ordering', async () => {
		const compactSsoGroup = await createUserGroup(
			PROJECT_ID,
			'Compact SSO',
			[],
			{ defaultDensity: 'compact', canChange: false },
			undefined,
			undefined,
			ssoMappings(['compact-sso']),
		);
		const newerManualGroup = await createUserGroup(PROJECT_ID, 'Newer Manual', [], {
			defaultDensity: 'detailed',
			canChange: false,
		});
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['compact-sso']);
		const originalSsoCreatedAt = new Date('2025-01-01T00:00:00Z');
		await db
			.update(userGroupMember)
			.set({ createdAt: originalSsoCreatedAt })
			.where(and(eq(userGroupMember.groupId, compactSsoGroup.id), eq(userGroupMember.provider, 'oidc')));
		await setUserGroupMembership(PROJECT_ID, newerManualGroup.id, DIRECT_USER_ID, true);
		await db
			.update(userGroupMember)
			.set({ createdAt: new Date('2025-02-01T00:00:00Z') })
			.where(eq(userGroupMember.groupId, newerManualGroup.id));

		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: { defaultDensity: 'detailed' },
		});
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['compact-sso']);

		const [unchangedMembership] = await db
			.select({ createdAt: userGroupMember.createdAt })
			.from(userGroupMember)
			.where(and(eq(userGroupMember.groupId, compactSsoGroup.id), eq(userGroupMember.provider, 'oidc')));
		expect(unchangedMembership.createdAt).toEqual(originalSsoCreatedAt);
		await expect(resolveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: { defaultDensity: 'detailed' },
		});
	});

	it('unions manual and OIDC memberships without duplicate effective grants or counts', async () => {
		const group = await createUserGroup(
			PROJECT_ID,
			'Finance',
			['storyCreation'],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['Finance-Team']),
		);
		await setUserGroupMembership(PROJECT_ID, group.id, DIRECT_USER_ID, true);
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', [' FINANCE-TEAM ']);
		await db.insert(userGroupMember).values({ groupId: group.id, userId: DIRECT_USER_ID, provider: 'microsoft' });
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'microsoft', []);

		const overview = await getUserGroupOverview(PROJECT_ID);
		expect(overview.memberships.filter((membership) => membership.groupId === group.id)).toEqual([
			{ groupId: group.id, userId: DIRECT_USER_ID },
		]);
		expect(overview.ssoMemberships).toContainEqual({
			groupId: group.id,
			userId: DIRECT_USER_ID,
			provider: 'oidc',
		});
		expect(await listUserGroupMemberships(PROJECT_ID)).toContainEqual({
			groupId: group.id,
			userId: DIRECT_USER_ID,
		});

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', []);
		expect((await getUserGroupOverview(PROJECT_ID)).memberships).toContainEqual({
			groupId: group.id,
			userId: DIRECT_USER_ID,
		});
		expect((await getUserGroupOverview(PROJECT_ID)).ssoMemberships).toEqual([]);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance-team']);
		await setUserGroupMembership(PROJECT_ID, group.id, DIRECT_USER_ID, false);
		expect((await getUserGroupOverview(PROJECT_ID)).memberships).toContainEqual({
			groupId: group.id,
			userId: DIRECT_USER_ID,
		});
	});

	it('provisions first project access and never revokes or rewrites it later', async () => {
		const group = await createUserGroup(
			FOREIGN_PROJECT_ID,
			'Analysts',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance'], 'user'),
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance']);
		await db
			.update(projectMember)
			.set({ role: 'context_admin' })
			.where(and(eq(projectMember.projectId, FOREIGN_PROJECT_ID), eq(projectMember.userId, DIRECT_USER_ID)));
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', []);

		await expect(projectMembership(FOREIGN_PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			role: 'context_admin',
		});
		expect(await listSsoGroupIds(DIRECT_USER_ID)).not.toContain(group.id);
	});

	it('uses the strongest default role and adds every matching group', async () => {
		const viewers = await createUserGroup(
			FOREIGN_PROJECT_ID,
			'Viewers',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['shared'], 'viewer'),
		);
		const admins = await createUserGroup(
			FOREIGN_PROJECT_ID,
			'Admins',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['shared'], 'admin'),
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['shared']);

		await expect(projectMembership(FOREIGN_PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({ role: 'admin' });
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual(expect.arrayContaining([viewers.id, admins.id]));
	});

	it('lets env mappings override the same claimed UI group while preserving other UI matches', async () => {
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		const uiFinance = await createUserGroup(
			PROJECT_ID,
			'UI Finance',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance']),
		);
		const sales = await createUserGroup(
			PROJECT_ID,
			'Sales',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['sales']),
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['FINANCE', 'sales'], {
			oidcMappings: [
				{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'wildcard analysts' },
				{ oidcGroup: 'finance', projectScope: PROJECT_ID, naoUserGroup: 'analysts' },
			],
		});

		const groupIds = await listSsoGroupIds(DIRECT_USER_ID);
		expect(groupIds).toEqual(expect.arrayContaining([analysts.id, sales.id]));
		expect(groupIds).not.toContain(uiFinance.id);
	});

	it('suppresses an OIDC UI mapping when its env target is unavailable', async () => {
		const uiFinance = await createUserGroup(
			PROJECT_ID,
			'UI Finance',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance']),
		);
		const sales = await createUserGroup(
			PROJECT_ID,
			'Sales',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['sales']),
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance', 'sales'], {
			oidcMappings: [
				{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'ui finance' },
				{ oidcGroup: 'finance', projectScope: PROJECT_ID, naoUserGroup: 'missing group' },
			],
		});

		const groupIds = await listSsoGroupIds(DIRECT_USER_ID);
		expect(groupIds).not.toContain(uiFinance.id);
		expect(groupIds).toContain(sales.id);
	});

	it('does not provision locked excess groups', async () => {
		const groups = await Promise.all(
			['One', 'Two', 'Three', 'Locked'].map((name) =>
				createUserGroup(
					FOREIGN_PROJECT_ID,
					name,
					[],
					DEFAULT_DENSITY,
					undefined,
					undefined,
					ssoMappings([name], 'user'),
				),
			),
		);
		for (const [index, group] of groups.entries()) {
			await db
				.update(userGroup)
				.set({ createdAt: new Date(`2025-01-0${index + 1}T00:00:00Z`) })
				.where(eq(userGroup.id, group.id));
		}

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['Locked'], {
			hasUnlimitedUserGroups: false,
		});

		await expect(projectMembership(FOREIGN_PROJECT_ID, DIRECT_USER_ID)).resolves.toBeNull();
		expect(await listSsoGroupIds(DIRECT_USER_ID)).not.toContain(groups[3].id);
	});

	it('suppresses UI fallback when env mappings target locked excess groups', async () => {
		const groups = await Promise.all(
			['Active UI', 'Two', 'Three', 'Locked'].map((name, index) =>
				createUserGroup(
					PROJECT_ID,
					name,
					[],
					DEFAULT_DENSITY,
					undefined,
					undefined,
					ssoMappings(index === 0 ? ['finance'] : []),
				),
			),
		);
		for (const [index, group] of groups.entries()) {
			await db
				.update(userGroup)
				.set({ createdAt: new Date(`2025-01-0${index + 1}T00:00:00Z`) })
				.where(eq(userGroup.id, group.id));
		}

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance'], {
			hasUnlimitedUserGroups: false,
			oidcMappings: [{ oidcGroup: 'finance', projectScope: '*', naoUserGroup: 'locked' }],
		});

		expect(await listSsoGroupIds(DIRECT_USER_ID)).not.toContain(groups[0].id);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).not.toContain(groups[3].id);
	});

	it('provisions project access for Microsoft mappings', async () => {
		const microsoftGroupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		const group = await createUserGroup(
			FOREIGN_PROJECT_ID,
			'Microsoft Analysts',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			{
				version: 1,
				providers: { oidc: [], microsoft: [microsoftGroupId] },
				defaultProjectRole: 'viewer',
			},
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'microsoft', [microsoftGroupId]);

		await expect(projectMembership(FOREIGN_PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({ role: 'viewer' });
		expect(await listSsoGroupIds(DIRECT_USER_ID, 'microsoft')).toContain(group.id);
	});

	it('lets Entra env mappings override the same UI Object ID while preserving other UI matches', async () => {
		const envGroupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		const otherGroupId = '11111111-2222-3333-4444-555555555555';
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts');
		const uiTarget = await createUserGroup(PROJECT_ID, 'UI target', [], DEFAULT_DENSITY, undefined, undefined, {
			version: 1,
			providers: { oidc: [], microsoft: [envGroupId] },
		});
		const otherTarget = await createUserGroup(
			PROJECT_ID,
			'Other target',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			{
				version: 1,
				providers: { oidc: [], microsoft: [otherGroupId] },
			},
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'microsoft', [envGroupId, otherGroupId], {
			entraMappings: [
				{ entraGroupId: envGroupId, projectScope: '*', naoUserGroup: 'wrong wildcard' },
				{ entraGroupId: envGroupId, projectScope: PROJECT_ID, naoUserGroup: 'ANALYSTS' },
			],
		});

		const groupIds = await listSsoGroupIds(DIRECT_USER_ID, 'microsoft');
		expect(groupIds).toEqual(expect.arrayContaining([analysts.id, otherTarget.id]));
		expect(groupIds).not.toContain(uiTarget.id);
	});

	it('suppresses an Entra UI mapping when its env target is unavailable', async () => {
		const envGroupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		const otherGroupId = '11111111-2222-3333-4444-555555555555';
		const overriddenTarget = await createUserGroup(
			PROJECT_ID,
			'Overridden target',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			{
				version: 1,
				providers: { oidc: [], microsoft: [envGroupId] },
			},
		);
		const unrelatedTarget = await createUserGroup(
			PROJECT_ID,
			'Unrelated target',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			{
				version: 1,
				providers: { oidc: [], microsoft: [otherGroupId] },
			},
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'microsoft', [envGroupId, otherGroupId], {
			entraMappings: [
				{ entraGroupId: envGroupId, projectScope: '*', naoUserGroup: 'overridden target' },
				{ entraGroupId: envGroupId, projectScope: PROJECT_ID, naoUserGroup: 'missing group' },
			],
		});

		const groupIds = await listSsoGroupIds(DIRECT_USER_ID, 'microsoft');
		expect(groupIds).not.toContain(overriddenTarget.id);
		expect(groupIds).toContain(unrelatedTarget.id);
	});

	it('never changes an existing explicit project role for an Entra default role', async () => {
		const microsoftGroupId = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
		await db
			.insert(projectMember)
			.values({ projectId: FOREIGN_PROJECT_ID, userId: DIRECT_USER_ID, role: 'viewer' })
			.onConflictDoNothing();
		await createUserGroup(FOREIGN_PROJECT_ID, 'Microsoft Admins', [], DEFAULT_DENSITY, undefined, undefined, {
			version: 1,
			providers: { oidc: [], microsoft: [microsoftGroupId] },
			defaultProjectRole: 'admin',
		});

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'microsoft', [microsoftGroupId]);

		await expect(projectMembership(FOREIGN_PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			role: 'viewer',
		});
	});

	it('replaces OIDC memberships, clears no-matches, and removes deleted mappings', async () => {
		const finance = await createUserGroup(
			PROJECT_ID,
			'Finance',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance']),
		);
		const sales = await createUserGroup(
			PROJECT_ID,
			'Sales',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['sales']),
		);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance']);
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['sales']);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([sales.id]);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['no-match']);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([]);

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance']);
		await updateUserGroup(PROJECT_ID, finance.id, {
			featureGrants: [],
			ssoMappings: ssoMappings([]),
		});
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([]);
	});

	it('does not reinsert access when mapping removal races reconciliation', async () => {
		const group = await createUserGroup(
			PROJECT_ID,
			'Finance',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance']),
		);

		const update = updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			ssoMappings: ssoMappings([]),
		});
		const reconciliation = reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance']);
		await Promise.all([update, reconciliation]);

		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([]);
	});

	it('invalidates only memberships for changed SSO providers', async () => {
		const group = await createUserGroup(PROJECT_ID, 'Mapped', [], DEFAULT_DENSITY, undefined, undefined, {
			version: 1,
			providers: {
				oidc: ['finance'],
				microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
			},
		});
		await db.insert(userGroupMember).values([
			{ groupId: group.id, userId: DIRECT_USER_ID, provider: 'oidc' },
			{ groupId: group.id, userId: DIRECT_USER_ID, provider: 'microsoft' },
		]);

		await updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			ssoMappings: {
				version: 1,
				providers: {
					oidc: [],
					microsoft: ['a0b1c2d3-e4f5-6789-abcd-ef0123456789'],
				},
			},
		});

		await expect(listUserGroupSsoMemberships(PROJECT_ID)).resolves.toEqual([
			{ groupId: group.id, userId: DIRECT_USER_ID, provider: 'microsoft' },
		]);
	});

	it('keeps memberships when SSO mappings are reordered', async () => {
		const group = await createUserGroup(
			PROJECT_ID,
			'Mapped',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance', 'sales']),
		);
		await db.insert(userGroupMember).values({ groupId: group.id, userId: DIRECT_USER_ID, provider: 'oidc' });

		await updateUserGroup(PROJECT_ID, group.id, {
			featureGrants: [],
			ssoMappings: ssoMappings(['sales', 'finance']),
		});

		await expect(listSsoGroupIds(DIRECT_USER_ID)).resolves.toEqual([group.id]);
	});

	it('rolls back an SSO mapping update when membership invalidation fails', async () => {
		const group = await createUserGroup(
			PROJECT_ID,
			'Mapped',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['finance']),
		);
		await db.insert(userGroupMember).values({ groupId: group.id, userId: DIRECT_USER_ID, provider: 'oidc' });
		db.$client.exec(`
			CREATE TRIGGER fail_sso_membership_delete
			BEFORE DELETE ON user_group_member
			WHEN OLD.provider != 'manual'
			BEGIN
				SELECT RAISE(ABORT, 'blocked delete');
			END;
		`);

		try {
			await expect(
				updateUserGroup(PROJECT_ID, group.id, {
					featureGrants: [],
					ssoMappings: ssoMappings([]),
				}),
			).rejects.toThrow('blocked delete');
			const [storedGroup] = await db.select().from(userGroup).where(eq(userGroup.id, group.id));
			expect(storedGroup.ssoMappings).toEqual(ssoMappings(['finance']));
			expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([group.id]);
		} finally {
			db.$client.exec('DROP TRIGGER IF EXISTS fail_sso_membership_delete');
		}
	});

	it('maps organization-inherited access and cleans inaccessible project rows', async () => {
		const inheritedGroup = await createUserGroup(
			PROJECT_ID,
			'Inherited',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['shared']),
		);
		const foreignGroup = await createUserGroup(
			FOREIGN_PROJECT_ID,
			'Foreign',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['shared']),
		);
		await db.insert(userGroupMember).values({ groupId: foreignGroup.id, userId: DIRECT_USER_ID, provider: 'oidc' });

		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['shared']);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([inheritedGroup.id]);

		await reconcileSsoUserGroupMemberships(INHERITED_USER_ID, 'oidc', ['shared']);
		expect((await listSsoGroupIds(INHERITED_USER_ID)).sort()).toEqual([foreignGroup.id, inheritedGroup.id].sort());
	});

	it('rolls back replacement when an SSO membership insert fails', async () => {
		const current = await createUserGroup(
			PROJECT_ID,
			'Current',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['current']),
		);
		const blocked = await createUserGroup(
			PROJECT_ID,
			'Blocked',
			[],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['blocked']),
		);
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['current']);
		db.$client.exec(`
			CREATE TRIGGER fail_sso_membership_insert
			BEFORE INSERT ON user_group_member
			WHEN NEW.group_id = '${blocked.id}' AND NEW.provider != 'manual'
			BEGIN
				SELECT RAISE(ABORT, 'blocked insert');
			END;
		`);

		await expect(reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['blocked'])).rejects.toThrow(
			'blocked insert',
		);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([current.id]);
	});

	it('rejects SSO mappings on All Users', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await expect(
			updateUserGroup(PROJECT_ID, overview.groups[0].id, {
				featureGrants: overview.groups[0].featureGrants,
				ssoMappings: ssoMappings(['everyone']),
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'The All Users group cannot be mapped to SSO groups.',
		});
		await expect(
			updateUserGroup(PROJECT_ID, overview.groups[0].id, {
				featureGrants: overview.groups[0].featureGrants,
				ssoMappings: ssoMappings([], 'viewer'),
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'The All Users group cannot be mapped to SSO groups.',
		});
	});
});

async function cleanup() {
	db.$client.exec('DROP TRIGGER IF EXISTS fail_sso_membership_insert');
	db.$client.exec('DROP TRIGGER IF EXISTS fail_sso_membership_delete');
	await db.delete(userGroupMember).where(eq(userGroupMember.userId, INHERITED_USER_ID));
	await db.delete(userGroup).where(eq(userGroup.projectId, PROJECT_ID));
	await db.delete(userGroup).where(eq(userGroup.projectId, FOREIGN_PROJECT_ID));
	await db.delete(projectMember).where(eq(projectMember.projectId, PROJECT_ID));
	await db.delete(orgMember).where(eq(orgMember.orgId, ORG_ID));
	await db.delete(project).where(eq(project.id, FOREIGN_PROJECT_ID));
	await db.delete(project).where(eq(project.id, PROJECT_ID));
	await db.delete(organization).where(eq(organization.id, ORG_ID));
	for (const userId of [DIRECT_USER_ID, INHERITED_USER_ID, BOTH_USER_ID, OUTSIDER_USER_ID]) {
		await db.delete(user).where(eq(user.id, userId));
	}
}

function ssoMappings(oidc: string[], defaultProjectRole?: UserRole) {
	return {
		version: 1 as const,
		providers: {
			oidc,
			microsoft: [],
		},
		...(defaultProjectRole ? { defaultProjectRole } : {}),
	};
}

async function listSsoGroupIds(userId: string, provider?: SsoGroupProvider): Promise<string[]> {
	return db
		.select({ groupId: userGroupMember.groupId })
		.from(userGroupMember)
		.where(
			provider
				? and(eq(userGroupMember.userId, userId), eq(userGroupMember.provider, provider))
				: and(eq(userGroupMember.userId, userId), inArray(userGroupMember.provider, ['oidc', 'microsoft'])),
		)
		.then((memberships) => memberships.map((membership) => membership.groupId));
}

async function projectMembership(projectId: string, userId: string) {
	const [membership] = await db
		.select()
		.from(projectMember)
		.where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
	return membership ?? null;
}
