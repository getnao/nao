import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isCloud: false }));

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../../src/services/license.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/license.service')>()),
	hasFeature: async () => true,
}));

vi.mock('../../src/utils/open-projects', () => ({
	isOpenProject: (projectId: string) => projectId === 'groups-as-code-project',
}));

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import {
	reconcileUserGroupsConfig,
	reconcileUserGroupsConfigsAtStartup,
} from '../../src/services/user-group-config-reconciliation.service';

const PROJECT_ID = 'groups-as-code-project';
const ACTOR_ID = 'groups-as-code-admin';
const IMPLICIT_USER_ID = 'groups-as-code-implicit-user';
const GROUP_ID = 'finance-group';
const LEGACY_GROUP_ID = 'legacy-group';
const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-groups-as-code-'));

describe('user group config reconciliation', () => {
	beforeAll(setup);
	afterAll(() => fs.rmSync(projectPath, { recursive: true, force: true }));

	it('adopts on the first apply, archives unlisted groups, reapplies idempotently, and reactivates', async () => {
		const configured = parseUserGroupsConfig(configSource(true));

		const enabled = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID);

		expect(enabled.summary).toMatchObject({ adopted: 1, archived: 1 });
		expect(enabled.pendingEmails).toEqual([]);
		expect(enabled.shareRevocations).toEqual({ chats: 1, stories: 0, automations: 0 });
		expect(await db.select().from(s.sharedChat)).toEqual([]);
		expect(await projectMode()).toBe('code');
		expect(await storedGroup()).toMatchObject({
			name: 'Finance team',
			configKey: 'finance',
			archivedAt: null,
			featureGrants: { advancedContextExplorer: true },
		});
		expect((await storedGroup(LEGACY_GROUP_ID)).archivedAt).not.toBeNull();
		expect(await memberships(IMPLICIT_USER_ID)).toEqual([{ provider: 'config', active: true }]);
		expect(await memberships()).toEqual([
			{ provider: 'config', active: true },
			{ provider: 'manual', active: false },
		]);

		const repeated = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID, 'deploy-id');
		expect(repeated.summary.unchanged).toBe(1);
		expect(repeated.allUsersChanged).toBe(false);
		const [deployActivity] = await db
			.select({ status: s.activity.status, payload: s.activity.payload })
			.from(s.activity)
			.where(eq(s.activity.id, 'deploy-id'));
		expect(deployActivity).toMatchObject({
			status: 'completed',
			payload: { deployId: 'deploy-id', hash: configured.hash },
		});

		const archived = await reconcileUserGroupsConfig(
			PROJECT_ID,
			parseUserGroupsConfig(configSource(false)),
			ACTOR_ID,
		);
		expect(archived.summary.archived).toBe(1);
		expect((await storedGroup()).archivedAt).not.toBeNull();

		const reactivated = await reconcileUserGroupsConfig(PROJECT_ID, configured, ACTOR_ID);
		expect(reactivated.summary.reactivated).toBe(1);
		expect(await storedGroup()).toMatchObject({ name: 'Finance team', archivedAt: null });
	});

	it('refuses to start self-hosted, skips an applied file, and only records the failure on Cloud', async () => {
		await expect(reconcileUserGroupsConfigsAtStartup()).rejects.toThrow('groups.yaml is missing');
		expect(await failedActivities()).toEqual([
			{ userId: null, trigger: 'system', errorMessage: expect.stringContaining('groups.yaml is missing') },
		]);

		fs.writeFileSync(path.join(projectPath, 'groups.yaml'), configSource(true));
		const activityCount = (await db.select().from(s.activity)).length;
		await expect(reconcileUserGroupsConfigsAtStartup()).resolves.toBeUndefined();
		expect(await db.select().from(s.activity)).toHaveLength(activityCount);

		mocks.isCloud = true;
		fs.writeFileSync(path.join(projectPath, 'groups.yaml'), 'version: 2\ngroups: []\n');
		await expect(reconcileUserGroupsConfigsAtStartup()).resolves.toBeUndefined();
		expect((await failedActivities())[1]).toMatchObject({ errorMessage: expect.stringContaining('version') });
		mocks.isCloud = false;
	});
});

async function setup() {
	await db.insert(s.user).values([
		{ id: ACTOR_ID, name: 'Admin', email: 'admin@example.com' },
		{ id: IMPLICIT_USER_ID, name: 'Implicit user', email: 'implicit@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Groups as code', type: 'local', path: projectPath });
	await db.insert(s.projectMember).values([
		{ projectId: PROJECT_ID, userId: ACTOR_ID, role: 'admin' },
		{ projectId: PROJECT_ID, userId: IMPLICIT_USER_ID, role: 'user' },
	]);
	await db.insert(s.userGroup).values([
		{ id: 'all-users-group', projectId: PROJECT_ID, name: 'All Users', isDefault: true },
		{ id: GROUP_ID, projectId: PROJECT_ID, name: 'Finance' },
		{ id: LEGACY_GROUP_ID, projectId: PROJECT_ID, name: 'Legacy' },
	]);
	await db.insert(s.userGroupMember).values([
		{ groupId: 'all-users-group', userId: ACTOR_ID, provider: 'manual', active: true },
		{ groupId: GROUP_ID, userId: ACTOR_ID, provider: 'manual', active: true },
	]);
	await db.insert(s.chat).values({ id: 'project-wide-chat', projectId: PROJECT_ID, userId: IMPLICIT_USER_ID });
	await db.insert(s.sharedChat).values({ chatId: 'project-wide-chat', visibility: 'project' });
}

async function projectMode() {
	const [project] = await db
		.select({ mode: s.project.userGroupManagementMode })
		.from(s.project)
		.where(eq(s.project.id, PROJECT_ID));
	return project!.mode;
}

async function storedGroup(groupId = GROUP_ID) {
	const [group] = await db.select().from(s.userGroup).where(eq(s.userGroup.id, groupId));
	return group!;
}

async function memberships(userId = ACTOR_ID) {
	return db
		.select({ provider: s.userGroupMember.provider, active: s.userGroupMember.active })
		.from(s.userGroupMember)
		.where(and(eq(s.userGroupMember.groupId, GROUP_ID), eq(s.userGroupMember.userId, userId)))
		.orderBy(s.userGroupMember.provider);
}

async function failedActivities() {
	return db
		.select({ userId: s.activity.userId, trigger: s.activity.trigger, errorMessage: s.activity.errorMessage })
		.from(s.activity)
		.where(and(eq(s.activity.projectId, PROJECT_ID), eq(s.activity.status, 'failed')));
}

function configSource(withFinance: boolean): string {
	return `
groups:
    - id: default
      capabilities:
          project_sharing: blocked
          mcp: {mode: all}
          skills: {mode: all}
      access:
          databases: {mode: all, strict: true}
          files: {mode: all}
    - id: all_users
${withFinance ? '    - id: finance\n      name: Finance team\n      list_of_emails: [admin@example.com, implicit@example.com]\n      capabilities:\n          advanced_context_explorer: true' : ''}
`;
}
