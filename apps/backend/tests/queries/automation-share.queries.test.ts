import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getAutomation, listAutomations } from '../../src/queries/automation.queries';
import { replaceAutomationShares, resolveAutomationRoles } from '../../src/queries/automation-share.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

vi.mock('../../src/queries/locked-user-groups', () => ({
	listLockedUserGroupIds: async () => [],
	listLockedUserGroupIdsOfMember: async () => [],
}));

const PROJECT_ID = 'automation-share-project';
const OWNER_ID = 'automation-share-owner';
const MEMBER_ID = 'automation-share-member';
const GROUP_MEMBER_ID = 'automation-share-group-member';
const GROUP_ID = 'automation-share-group';
const AUTOMATION = { id: 'shared-automation', userId: OWNER_ID };

describe('automation sharing', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: OWNER_ID, name: 'Owner', email: 'owner@example.com' },
			{ id: MEMBER_ID, name: 'Member', email: 'member@example.com' },
			{ id: GROUP_MEMBER_ID, name: 'Group member', email: 'group-member@example.com' },
		]);
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Project', type: 'local', path: '/tmp/share' });
		await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Finance' });
		await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: GROUP_MEMBER_ID });
		await db.insert(s.automation).values({ ...AUTOMATION, projectId: PROJECT_ID, title: 'Report', prompt: 'Run' });
	});

	beforeEach(async () => {
		await replaceAutomationShares(AUTOMATION.id, []);
	});

	afterAll(async () => {
		await db.delete(s.project).execute();
		await db.delete(s.user).execute();
	});

	it('keeps an unshared automation private to its owner', async () => {
		await expect(rolesOf([OWNER_ID, MEMBER_ID, GROUP_MEMBER_ID])).resolves.toEqual(['owner', null, null]);
		await expect(listAutomations(PROJECT_ID, MEMBER_ID)).resolves.toEqual([]);
	});

	it('gives every project member the project role, unless they have their own', async () => {
		await replaceAutomationShares(AUTOMATION.id, [
			{ userId: null, groupId: null, role: 'editor' },
			{ userId: MEMBER_ID, groupId: null, role: 'viewer' },
		]);

		await expect(rolesOf([MEMBER_ID, GROUP_MEMBER_ID])).resolves.toEqual(['viewer', 'editor']);
	});

	it('gives group members the group role', async () => {
		await replaceAutomationShares(AUTOMATION.id, [{ userId: null, groupId: GROUP_ID, role: 'editor' }]);

		await expect(rolesOf([MEMBER_ID, GROUP_MEMBER_ID])).resolves.toEqual([null, 'editor']);
	});

	it('lists shared automations and refuses roles above the one granted', async () => {
		await replaceAutomationShares(AUTOMATION.id, [{ userId: MEMBER_ID, groupId: null, role: 'viewer' }]);

		const [listed] = await listAutomations(PROJECT_ID, MEMBER_ID);
		expect(listed).toMatchObject({ id: AUTOMATION.id, accessRole: 'viewer', ownerName: 'Owner' });
		await expect(getAutomation(PROJECT_ID, MEMBER_ID, AUTOMATION.id, 'viewer')).resolves.not.toBeNull();
		await expect(getAutomation(PROJECT_ID, MEMBER_ID, AUTOMATION.id, 'editor')).resolves.toBeNull();
	});
});

async function rolesOf(userIds: string[]) {
	return Promise.all(
		userIds.map(async (userId) => (await resolveAutomationRoles([AUTOMATION], userId)).get(AUTOMATION.id) ?? null),
	);
}
