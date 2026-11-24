import fs from 'node:fs';
import path from 'node:path';

import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
});

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const mocks = vi.hoisted(() => ({
	hasFeature: vi.fn(async () => true),
	revokeUnauthorizedProjectWideShares: vi.fn(),
}));

vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: {
		userGroups: 'user-groups',
		rowLevelSecurity: 'row-level-security',
	},
}));

vi.mock('../../src/services/project-sharing.service', () => ({
	revokeUnauthorizedProjectWideShares: mocks.revokeUnauthorizedProjectWideShares,
}));

vi.mock('../../src/services/warehouse-sql.service', () => ({
	validateWarehouseRowPredicate: vi.fn(),
}));

import { db } from '../../src/db/db';
import {
	activity,
	organization,
	orgMember,
	project,
	projectMember,
	user,
	userGroup,
	userGroupMember,
} from '../../src/db/sqlite-schema';
import { __reloadEnvForTesting } from '../../src/env';
import { createProject } from '../../src/queries/project.queries';
import { createUserGroup, listUserGroups, updateUserGroup } from '../../src/queries/user-group.queries';
import { parseGroupsConfig } from '../../src/services/groups-config.service';
import {
	applyAllProjectGroupsFiles,
	applyProjectGroupsFile,
	createProjectWithGroupsConfig,
	reconcileGroupsMembershipsForUser,
	validateProjectGroupsFile,
} from '../../src/services/groups-config-apply.service';
import { exportGroupsConfig } from '../../src/services/groups-config-export.service';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();
restoreProcessEnvAfterEach({ afterRestore: __reloadEnvForTesting });
const PROJECT_ID = 'groups-config-project';
const USER_ID = 'groups-config-user';

describe('groups config apply', () => {
	let projectPath: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(true);
		await db.delete(activity);
		await db.delete(project);
		await db.delete(user);
		await db.delete(organization);
		projectPath = createTemporaryFolder('groups-config-');
		await db.insert(organization).values({ id: 'groups-config-org', name: 'Groups Config', slug: 'groups-config' });
		await createProject({
			id: PROJECT_ID,
			orgId: 'groups-config-org',
			name: 'Groups Config',
			type: 'local',
			path: projectPath,
		});
		await db.insert(user).values({ id: USER_ID, name: 'Alice', email: 'alice@example.com' });
		await db.insert(projectMember).values({ projectId: PROJECT_ID, userId: USER_ID, role: 'user' });
	});

	it('adopts an existing UI group, assigns members, and does not reapply an unchanged file', async () => {
		const existingId = 'existing-finance';
		await db.insert(userGroup).values({
			id: existingId,
			projectId: PROJECT_ID,
			name: 'Finance',
			isDefault: false,
		});
		writeGroups(`
groups:
    - id: all_users
    - id: finance
      name: Finance
      list_of_emails: [alice@example.com, pending@example.com]
`);

		expect(await applyProjectGroupsFile(PROJECT_ID, projectPath, USER_ID)).toBe(true);
		expect(await applyProjectGroupsFile(PROJECT_ID, projectPath, USER_ID)).toBe(false);

		const groups = await db.select().from(userGroup).where(eq(userGroup.projectId, PROJECT_ID));
		expect(groups.filter((group) => !group.isDefault)).toEqual([
			expect.objectContaining({
				id: existingId,
				configId: 'finance',
				archivedAt: null,
				memberEmails: ['alice@example.com', 'pending@example.com'],
			}),
		]);
		expect(await db.select().from(userGroupMember)).toEqual([
			expect.objectContaining({ groupId: existingId, userId: USER_ID, provider: 'manual' }),
		]);
		const [{ value: appliedCount }] = await db
			.select({ value: count() })
			.from(activity)
			.where(eq(activity.type, 'user_group.config_applied'));
		expect(appliedCount).toBe(1);
		expect(mocks.revokeUnauthorizedProjectWideShares).toHaveBeenCalledTimes(2);
		await expect(createUserGroup(PROJECT_ID, 'Blocked in code mode')).rejects.toMatchObject({ code: 'FORBIDDEN' });
		const storedFinance = (await listUserGroups(PROJECT_ID)).find((group) => group.id === existingId)!;
		const exportedFinance = parseGroupsConfig(await exportGroupsConfig(PROJECT_ID)).groups[0];
		expect(exportedFinance).toMatchObject({
			name: storedFinance.name,
			memberEmails: storedFinance.memberEmails,
			features: storedFinance.featureGrants,
			databaseAccess: storedFinance.databaseAccess,
			mcpAccess: storedFinance.mcpAccess,
			skillsAccess: storedFinance.skillsAccess,
			rowPolicies: storedFinance.rowPolicies,
			columnPolicies: storedFinance.columnPolicies,
		});

		const pendingUserId = 'pending-user';
		await db.insert(user).values({ id: pendingUserId, name: 'Pending', email: 'pending@example.com' });
		await db.insert(projectMember).values({ projectId: PROJECT_ID, userId: pendingUserId, role: 'user' });
		await reconcileGroupsMembershipsForUser(pendingUserId);
		expect(await db.select().from(userGroupMember).where(eq(userGroupMember.userId, pendingUserId))).toEqual([
			expect.objectContaining({ groupId: existingId, provider: 'manual' }),
		]);

		mocks.hasFeature.mockResolvedValue(false);
		writeGroups(`
groups:
    - id: all_users
    - id: finance
      name: Finance
      list_of_emails: [alice@example.com, pending@example.com, later@example.com]
`);
		await expect(validateProjectGroupsFile(PROJECT_ID, projectPath, true)).resolves.not.toThrow();
		expect(await applyProjectGroupsFile(PROJECT_ID, projectPath, USER_ID)).toBe(true);
	});

	it('exports manual memberships and all files with restricted docs before the project switches to code', async () => {
		const ssoUserId = 'sso-user';
		await db.insert(user).values({ id: ssoUserId, name: 'Bob', email: 'bob@example.com' });
		await db.insert(projectMember).values({ projectId: PROJECT_ID, userId: ssoUserId, role: 'user' });
		await db
			.insert(userGroup)
			.values({ id: 'ui-finance', projectId: PROJECT_ID, name: 'Finance', isDefault: false });
		await db.insert(userGroupMember).values([
			{ groupId: 'ui-finance', userId: USER_ID, provider: 'manual' },
			{ groupId: 'ui-finance', userId: ssoUserId, provider: 'oidc' },
		]);
		const docsAccess = { mode: 'restricted' as const, grants: [{ kind: 'folder' as const, path: 'finance' }] };
		await updateUserGroup(PROJECT_ID, 'ui-finance', {
			featureGrants: [],
			docsAccess,
			filesAccess: { mode: 'all' },
		});

		const exported = parseGroupsConfig(await exportGroupsConfig(PROJECT_ID));

		expect(exported.groups[0]).toMatchObject({
			memberEmails: ['alice@example.com'],
			docsAccess,
			filesAccess: { mode: 'all' },
		});
	});

	it('applies only the configured projects at self-hosted startup', async () => {
		process.env.NAO_DEFAULT_PROJECT_PATH = projectPath;
		__reloadEnvForTesting();
		await createProject({
			id: 'stale-project',
			orgId: 'groups-config-org',
			name: 'Stale',
			type: 'local',
			path: createTemporaryFolder('groups-config-stale-'),
		});
		await db.update(project).set({ userGroupsConfigAppliedAt: new Date() }).where(eq(project.id, 'stale-project'));
		writeGroups('groups:\n    - id: all_users\n    - id: finance\n');

		await expect(applyAllProjectGroupsFiles()).resolves.toBeUndefined();
		expect((await listUserGroups(PROJECT_ID)).map((group) => group.configId)).toContain('finance');
	});

	it('archives unlisted groups and reactivates the same row when its id returns', async () => {
		const existingId = 'existing-finance';
		await db.insert(userGroup).values({
			id: existingId,
			projectId: PROJECT_ID,
			name: 'Finance',
			isDefault: false,
		});
		writeGroups('groups:\n    - id: all_users\n');
		await applyProjectGroupsFile(PROJECT_ID, projectPath, USER_ID);
		expect((await db.select().from(userGroup).where(eq(userGroup.id, existingId)))[0].archivedAt).not.toBeNull();

		writeGroups('groups:\n    - id: all_users\n    - id: finance\n      name: Finance\n');
		await applyProjectGroupsFile(PROJECT_ID, projectPath, USER_ID);
		expect(await db.select().from(userGroup).where(eq(userGroup.id, existingId))).toEqual([
			expect.objectContaining({ id: existingId, name: 'Finance', archivedAt: null }),
		]);
	});

	it('creates a new project and its configured groups atomically', async () => {
		const newProjectId = 'new-groups-config-project';
		await db.insert(orgMember).values({ orgId: 'groups-config-org', userId: USER_ID, role: 'user' });
		const created = await createProjectWithGroupsConfig(
			{
				id: newProjectId,
				orgId: 'groups-config-org',
				name: 'New Groups Config',
				type: 'local',
				path: path.join(projectPath, 'new-project'),
			},
			parseGroupsConfig(`
groups:
    - id: all_users
    - id: finance
      name: Finance
      list_of_emails: [alice@example.com, pending@example.com]
`),
			USER_ID,
		);

		expect(created.id).toBe(newProjectId);
		const groups = await db.select().from(userGroup).where(eq(userGroup.projectId, newProjectId));
		expect(groups).toEqual([
			expect.objectContaining({ isDefault: true, configId: 'all_users' }),
			expect.objectContaining({
				isDefault: false,
				configId: 'finance',
				memberEmails: ['alice@example.com', 'pending@example.com'],
			}),
		]);
		expect(await db.select().from(userGroupMember).where(eq(userGroupMember.groupId, groups[1].id))).toEqual([
			expect.objectContaining({ userId: USER_ID, provider: 'manual' }),
		]);
		expect(await db.select().from(activity).where(eq(activity.projectId, newProjectId))).toEqual([
			expect.objectContaining({ type: 'user_group.config_applied', status: 'completed' }),
		]);
	});

	function writeGroups(source: string): void {
		fs.writeFileSync(path.join(projectPath, 'groups.yaml'), source);
	}
});
