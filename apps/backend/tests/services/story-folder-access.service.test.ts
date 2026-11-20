import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { createFolder, ensurePrivateRoot, getFolderById } from '../../src/queries/story-folder.queries';
import { getFolderAccess } from '../../src/services/story-folder-access.service';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'folder-access-project';
const CREATOR_ID = 'folder-access-creator';
const MEMBER_ID = 'folder-access-member';
const OUTSIDER_ID = 'folder-access-outsider';
const ADMIN_ID = 'folder-access-admin';
const GROUP_ID = 'folder-access-sales';

describe('getFolderAccess', () => {
	beforeAll(async () => {
		const users = [CREATOR_ID, MEMBER_ID, OUTSIDER_ID, ADMIN_ID];
		await db.insert(s.user).values(users.map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Folder access', type: 'local', path: '/tmp/fa' });
		await db.insert(s.projectMember).values(
			users.map((userId) => ({
				projectId: PROJECT_ID,
				userId,
				role: userId === ADMIN_ID ? ('admin' as const) : ('user' as const),
			})),
		);
		await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Sales' });
		await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: MEMBER_ID });
	});

	afterAll(() => {
		db.$client.close();
	});

	it('lists who sees a subfolder of a team folder: its groups and the admins, not its creator outside them', async () => {
		const sales = await createFolder({
			ownerId: CREATOR_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		const emea = await createFolder({
			ownerId: MEMBER_ID,
			projectId: PROJECT_ID,
			name: 'EMEA',
			parentId: sales.id,
		});

		expect(await getFolderAccess(emea)).toEqual({
			kind: 'groups',
			people: [
				{ ...personOf(ADMIN_ID), groupNames: [], isAdmin: true },
				{ ...personOf(MEMBER_ID), groupNames: ['Sales'], isAdmin: false },
			],
		});
	});

	it.each([
		{
			label: 'an open folder',
			makeFolder: () => createFolder({ ownerId: CREATOR_ID, projectId: PROJECT_ID, name: 'Open' }),
			expected: { kind: 'project', memberCount: 4 },
		},
		{
			label: 'a private folder',
			makeFolder: async () => (await getFolderById(await ensurePrivateRoot(CREATOR_ID, PROJECT_ID)))!,
			expected: { kind: 'private' },
		},
	])('tells who sees $label', async ({ makeFolder, expected }) => {
		expect(await getFolderAccess(await makeFolder())).toEqual(expected);
	});
});

function personOf(id: string) {
	return { id, name: id, email: `${id}@example.com` };
}
