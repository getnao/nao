import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

vi.mock('../../src/utils/open-projects', () => ({
	isOpenProject: (projectId: string) => projectId === 'groups-as-code-project',
}));

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { listUsersWithProjectAccessDetails } from '../../src/queries/project.queries';
import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import {
	disableCodeManagedUserGroups,
	reconcileUserGroupsConfig,
} from '../../src/services/user-group-config-reconciliation.service';

const PROJECT_ID = 'groups-as-code-project';
const ACTOR_ID = 'groups-as-code-admin';
const IMPLICIT_USER_ID = 'groups-as-code-implicit-user';
const GROUP_ID = 'finance-group';

async function setup() {
	await db.insert(s.user).values([
		{
			id: ACTOR_ID,
			name: 'Admin',
			email: 'admin@example.com',
		},
		{
			id: IMPLICIT_USER_ID,
			name: 'Implicit user',
			email: 'implicit@example.com',
		},
	]);
	await db.insert(s.project).values({
		id: PROJECT_ID,
		name: 'Groups as code',
		type: 'local',
		path: '/tmp/groups-as-code',
	});
	await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: ACTOR_ID, role: 'admin' });
	await db.insert(s.userGroup).values([
		{ id: 'all-users-group', projectId: PROJECT_ID, name: 'All Users', isDefault: true },
		{ id: GROUP_ID, projectId: PROJECT_ID, name: 'Finance' },
	]);
	await db.insert(s.userGroupMember).values([
		{ groupId: 'all-users-group', userId: ACTOR_ID, provider: 'manual', active: true },
		{ groupId: GROUP_ID, userId: ACTOR_ID, provider: 'manual', active: true },
	]);
}

describe('user group config reconciliation', () => {
	it('adopts, idempotently reapplies, archives, reactivates, and returns ownership to the UI', async () => {
		await setup();
		const configured = parseUserGroupsConfig(configSource(true));
		expect(await listUsersWithProjectAccessDetails(PROJECT_ID)).toEqual([
			expect.objectContaining({ id: ACTOR_ID, emailVerified: false }),
		]);
		const enabled = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID);

		expect(enabled.summary.adopted).toBe(1);
		expect(enabled.pendingEmails).toEqual([]);
		expect(enabled.allUsersChanged).toBe(true);
		expect(enabled.accessChanges).toContain('finance');
		expect(enabled.budgetChanges).toEqual(['all_users']);
		expect(await projectMode()).toBe('code');
		expect(await storedGroup()).toMatchObject({ id: GROUP_ID, configKey: 'finance', archivedAt: null });
		expect(await memberships(IMPLICIT_USER_ID)).toEqual([{ provider: 'config', active: true }]);
		expect(await memberships()).toEqual([
			{ provider: 'config', active: true },
			{ provider: 'manual', active: false },
		]);
		expect(
			await db
				.select({ active: s.userGroupMember.active })
				.from(s.userGroupMember)
				.where(eq(s.userGroupMember.groupId, 'all-users-group')),
		).toEqual([{ active: true }]);
		expect(
			await db
				.select({ limitUsd: s.projectMemberBudgetSettings.defaultLimitUsd })
				.from(s.projectMemberBudgetSettings)
				.where(eq(s.projectMemberBudgetSettings.projectId, PROJECT_ID)),
		).toEqual([{ limitUsd: 25 }]);

		const repeated = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID);
		expect(repeated.summary.unchanged).toBe(1);
		expect(repeated.allUsersChanged).toBe(false);
		expect(repeated.accessChanges).toEqual([]);
		expect(repeated.budgetChanges).toEqual([]);

		const archived = await reconcileUserGroupsConfig(
			PROJECT_ID,
			parseUserGroupsConfig(configSource(false)),
			ACTOR_ID,
		);
		expect(archived.summary.archived).toBe(1);
		expect((await storedGroup()).archivedAt).not.toBeNull();

		const reactivated = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID);
		expect(reactivated.summary.reactivated).toBe(1);
		expect(await storedGroup()).toMatchObject({ id: GROUP_ID, name: 'Finance', archivedAt: null });

		await disableCodeManagedUserGroups(PROJECT_ID, ACTOR_ID);
		expect(await projectMode()).toBe('ui');
		expect(await memberships()).toEqual([
			{ provider: 'config', active: false },
			{ provider: 'manual', active: true },
		]);
		const [assignment] = await db
			.select({ active: s.userGroupConfigMember.active })
			.from(s.userGroupConfigMember)
			.where(eq(s.userGroupConfigMember.groupId, GROUP_ID));
		expect(assignment?.active).toBe(false);
	});
});

async function projectMode() {
	const [project] = await db
		.select({ mode: s.project.userGroupManagementMode })
		.from(s.project)
		.where(eq(s.project.id, PROJECT_ID));
	return project!.mode;
}

async function storedGroup() {
	const [group] = await db.select().from(s.userGroup).where(eq(s.userGroup.id, GROUP_ID));
	return group!;
}

async function memberships(userId = ACTOR_ID) {
	return db
		.select({ provider: s.userGroupMember.provider, active: s.userGroupMember.active })
		.from(s.userGroupMember)
		.where(and(eq(s.userGroupMember.groupId, GROUP_ID), eq(s.userGroupMember.userId, userId)))
		.orderBy(s.userGroupMember.provider);
}

function configSource(withFinance: boolean): string {
	return `
version: 1
defaults:
  features: []
  tool_call_density: { default_density: detailed, can_change: true }
  show_all_settings: false
  project_sharing: inherit
  share_targets: { include_own_group: true, group_keys: [] }
  preloaded_skills: []
  budget_limit_usd: null
  database_access: { mode: all, strict: true }
  docs_access: { mode: all }
  files_access: { mode: all }
  mcp_access: { mode: all }
  skills_access: { mode: all }
  row_policies: { version: 1, policies: [] }
all_users:
  budget_limit_usd: 25
groups:
${withFinance ? '  - key: finance\n    name: Finance\n    members: [admin@example.com, implicit@example.com]' : '  []'}
`;
}
