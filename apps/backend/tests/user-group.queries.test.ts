import { eq } from 'drizzle-orm';
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
	userGroupSsoMember,
} from '../src/db/sqlite-schema';
import { createProject } from '../src/queries/project.queries';
import { reconcileSsoUserGroupMemberships } from '../src/queries/sso-user-group-membership.queries';
import {
	addUserGroupMemberships,
	countCustomUserGroups,
	createUserGroup,
	deleteUserGroup,
	getUserGroupOverview,
	listUserGroupMemberships,
	resolveEffectiveUserGroupAccess,
	setUserGroupMembership,
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
				features: ['story-creation', 'automation-creation'],
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
			featureGrants: ['story-creation', 'automation-creation'],
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
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
			updateUserGroup(PROJECT_ID, defaultGroup?.id ?? '', { featureGrants: ['automation-creation'] }),
		).resolves.toMatchObject({
			featureGrants: ['automation-creation'],
		});
	});

	it('does not write when reading a project without user groups', async () => {
		await db.delete(userGroup).where(eq(userGroup.projectId, PROJECT_ID));

		await expect(getUserGroupOverview(PROJECT_ID)).resolves.toMatchObject({ groups: [] });
		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([]);
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
			featureGrants: ['story-creation'],
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
			featureGrants: ['story-creation'],
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
			features: ['story-creation'],
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

		await updateUserGroup(PROJECT_ID, defaultGroup.id, { featureGrants: ['automation-creation'] });
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

	it('resolves every feature for an untouched project', async () => {
		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'story-creation',
			'automation-creation',
		]);
	});

	it('unions grants from the default and explicit groups', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['story-creation'] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['automation-creation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'story-creation',
			'automation-creation',
		]);
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

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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

	it('uses a custom group when the default has no grants', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: [] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['story-creation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'story-creation',
		]);
	});

	it('deduplicates grants shared by multiple groups', async () => {
		const overview = await getUserGroupOverview(PROJECT_ID);
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['story-creation'] });
		const analysts = await createUserGroup(PROJECT_ID, 'Analysts', ['story-creation', 'automation-creation']);
		await setUserGroupMembership(PROJECT_ID, analysts.id, DIRECT_USER_ID, true);

		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'story-creation',
			'automation-creation',
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
					'story-creation',
					'stories',
					'automations',
					'automation-creation',
					'automations',
				] as never,
			})
			.where(eq(userGroup.id, defaultGroup.id));

		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'story-creation',
			'automation-creation',
		]);
		await expect(getUserGroupOverview(PROJECT_ID)).resolves.toMatchObject({
			groups: [
				expect.objectContaining({
					featureGrants: ['story-creation', 'automation-creation'],
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
		await updateUserGroup(PROJECT_ID, overview.groups[0].id, { featureGrants: ['automation-creation'] });
		await createUserGroup(PROJECT_ID, 'Analysts', ['story-creation']);

		expect((await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).features).toEqual([
			'automation-creation',
		]);
	});

	it('resolves effective names from All Users, manual, and SSO memberships within the project', async () => {
		const finance = await createUserGroup(PROJECT_ID, 'Finance');
		const marketing = await createUserGroup(PROJECT_ID, 'Marketing');
		const foreign = await createUserGroup(FOREIGN_PROJECT_ID, 'Foreign');
		await setUserGroupMembership(PROJECT_ID, finance.id, DIRECT_USER_ID, true);
		await db.insert(userGroupSsoMember).values([
			{ groupId: marketing.id, userId: DIRECT_USER_ID, provider: 'oidc' },
			{ groupId: foreign.id, userId: DIRECT_USER_ID, provider: 'oidc' },
		]);

		const access = await resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID);

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

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				canChange: false,
			},
		});

		const unlockedGroup = await createUserGroup(PROJECT_ID, 'Unlocked', [], {
			defaultDensity: 'detailed',
			canChange: true,
		});
		await setUserGroupMembership(PROJECT_ID, unlockedGroup.id, DIRECT_USER_ID, true);
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
			},
		});

		await setUserGroupMembership(PROJECT_ID, compactGroup.id, DIRECT_USER_ID, false);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await setUserGroupMembership(PROJECT_ID, compactGroup.id, DIRECT_USER_ID, true);
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
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
			.update(userGroupSsoMember)
			.set({ createdAt: originalSsoCreatedAt })
			.where(eq(userGroupSsoMember.groupId, compactSsoGroup.id));
		await setUserGroupMembership(PROJECT_ID, newerManualGroup.id, DIRECT_USER_ID, true);
		await db
			.update(userGroupMember)
			.set({ createdAt: new Date('2025-02-01T00:00:00Z') })
			.where(eq(userGroupMember.groupId, newerManualGroup.id));

		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: { defaultDensity: 'detailed' },
		});
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['compact-sso']);

		const [unchangedMembership] = await db
			.select({ createdAt: userGroupSsoMember.createdAt })
			.from(userGroupSsoMember)
			.where(eq(userGroupSsoMember.groupId, compactSsoGroup.id));
		expect(unchangedMembership.createdAt).toEqual(originalSsoCreatedAt);
		await expect(resolveEffectiveUserGroupAccess(PROJECT_ID, DIRECT_USER_ID)).resolves.toMatchObject({
			toolCallDensityPolicy: { defaultDensity: 'detailed' },
		});
	});

	it('unions manual and OIDC memberships without duplicate effective grants or counts', async () => {
		const group = await createUserGroup(
			PROJECT_ID,
			'Finance',
			['story-creation'],
			DEFAULT_DENSITY,
			undefined,
			undefined,
			ssoMappings(['Finance-Team']),
		);
		await setUserGroupMembership(PROJECT_ID, group.id, DIRECT_USER_ID, true);
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', [' FINANCE-TEAM ']);
		await db
			.insert(userGroupSsoMember)
			.values({ groupId: group.id, userId: DIRECT_USER_ID, provider: 'microsoft' });
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
		await reconcileSsoUserGroupMemberships(DIRECT_USER_ID, 'oidc', ['finance']);
		expect(await listSsoGroupIds(DIRECT_USER_ID)).toEqual([]);
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
		await db
			.insert(userGroupSsoMember)
			.values({ groupId: foreignGroup.id, userId: DIRECT_USER_ID, provider: 'oidc' });

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
			BEFORE INSERT ON user_group_sso_member
			WHEN NEW.group_id = '${blocked.id}'
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
	});
});

async function cleanup() {
	db.$client.exec('DROP TRIGGER IF EXISTS fail_sso_membership_insert');
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

function ssoMappings(oidc: string[]) {
	return {
		version: 1 as const,
		providers: {
			oidc,
			microsoft: [],
		},
	};
}

async function listSsoGroupIds(userId: string): Promise<string[]> {
	return db
		.select({ groupId: userGroupSsoMember.groupId })
		.from(userGroupSsoMember)
		.where(eq(userGroupSsoMember.userId, userId))
		.then((memberships) => memberships.map((membership) => membership.groupId));
}
