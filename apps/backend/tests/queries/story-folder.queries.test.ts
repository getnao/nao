import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getStoryShareAccess } from '../../src/queries/shared-story.queries';
import { canUserAccessStory } from '../../src/queries/story.queries';
import type { FolderViewer } from '../../src/queries/story-folder.queries';
import {
	archiveFolder,
	createFolder,
	deleteFolderMovingContentsToParent,
	ensurePrivateRoot,
	getStoryFolderItem,
	listFolderTree,
	moveFolder,
	moveStoryToFolder,
	setGroupTeamFolders,
	TeamFolderError,
	unarchiveFolder,
} from '../../src/queries/story-folder.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'team-folder-project';
const STORY_ID = 'team-folder-story';
const OWNER_ID = 'team-folder-owner';
const MEMBER_ID = 'team-folder-member';
const OUTSIDER_ID = 'team-folder-outsider';
const ADMIN_ID = 'team-folder-admin';
const GROUP_ID = 'team-folder-sales';

const USER_IDS = [OWNER_ID, MEMBER_ID, OUTSIDER_ID, ADMIN_ID];

describe('team folders', () => {
	beforeAll(async () => {
		await db.insert(s.user).values(USER_IDS.map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Team folders', type: 'local', path: '/tmp/tf' });
		await db.insert(s.projectMember).values(
			USER_IDS.map((userId) => ({
				projectId: PROJECT_ID,
				userId,
				role: userId === ADMIN_ID ? ('admin' as const) : ('user' as const),
			})),
		);
		await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Sales' });
		await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: MEMBER_ID });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, slug: 'pipeline', title: 'Pipeline' });
	});

	beforeEach(async () => {
		await db.delete(s.sharedStory);
		await db.delete(s.storyFolderItem);
		await db.delete(s.storyFolder);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('shows a team folder and its subfolders only to its groups and admins, like its stories', async () => {
		const sales = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		await createFolder({ ownerId: MEMBER_ID, projectId: PROJECT_ID, name: 'EMEA', parentId: sales.id });

		expect(await visibleFolderNames(viewerOf(MEMBER_ID, [GROUP_ID]))).toEqual(['EMEA', 'Sales']);
		expect(await visibleFolderNames(viewerOf(ADMIN_ID, [], true))).toEqual(['EMEA', 'Sales']);
		expect(await visibleFolderNames(viewerOf(OWNER_ID))).toEqual([]);
		expect(await visibleFolderNames(viewerOf(OUTSIDER_ID))).toEqual([]);
	});

	it('gives the stories of a deleted team folder back to their owners and keeps its subfolders for its groups', async () => {
		const sales = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		await createFolder({ ownerId: OWNER_ID, projectId: PROJECT_ID, name: 'EMEA', parentId: sales.id });
		const privateRoot = await ensurePrivateRoot(OWNER_ID, PROJECT_ID);
		await moveStoryToFolder(STORY_ID, sales.id, { storyOwnerId: OWNER_ID, projectId: PROJECT_ID });

		await deleteFolderMovingContentsToParent(sales.id);

		expect(await getStoryFolderItem(STORY_ID)).toEqual({ folderId: privateRoot });
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toBeNull();
		expect(await visibleFolderNames(viewerOf(MEMBER_ID, [GROUP_ID]))).toEqual(['EMEA']);
		expect(await visibleFolderNames(viewerOf(OUTSIDER_ID))).toEqual([]);
	});

	it('keeps an archived team folder with its group when the group saves its folders', async () => {
		const sales = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		await archiveFolder(sales.id);

		await setGroupTeamFolders(PROJECT_ID, GROUP_ID, [], ADMIN_ID);
		await unarchiveFolder(OWNER_ID, PROJECT_ID, sales.id);

		expect(await visibleFolderNames(viewerOf(OUTSIDER_ID))).toEqual([]);
	});

	it("shares a story with the folder's groups while it is filed there", async () => {
		const sales = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		const privateRoot = await ensurePrivateRoot(OWNER_ID, PROJECT_ID);
		const placement = { storyOwnerId: OWNER_ID, projectId: PROJECT_ID };

		await moveStoryToFolder(STORY_ID, sales.id, placement);
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toMatchObject({
			visibility: 'specific',
			allowedGroupIds: [GROUP_ID],
		});

		await moveStoryToFolder(STORY_ID, null, placement);
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toMatchObject({ visibility: 'project' });

		await moveStoryToFolder(STORY_ID, privateRoot, placement);
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toBeNull();
	});

	it('lets admins outside its groups open the stories of a team folder, and only while they are filed there', async () => {
		const sales = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			groupIds: [GROUP_ID],
		});
		const emea = await createFolder({ ownerId: OWNER_ID, projectId: PROJECT_ID, name: 'EMEA', parentId: sales.id });
		const privateRoot = await ensurePrivateRoot(OWNER_ID, PROJECT_ID);
		const placement = { storyOwnerId: OWNER_ID, projectId: PROJECT_ID };

		await moveStoryToFolder(STORY_ID, emea.id, placement);
		expect(await canUserAccessStory(STORY_ID, ADMIN_ID)).toBe(true);
		expect(await canUserAccessStory(STORY_ID, OUTSIDER_ID)).toBe(false);

		await moveStoryToFolder(STORY_ID, privateRoot, placement);
		expect(await canUserAccessStory(STORY_ID, ADMIN_ID)).toBe(false);
	});

	it('refuses to nest team folders, even when both are added at once', async () => {
		const parent = await createFolder({ ownerId: OWNER_ID, projectId: PROJECT_ID, name: 'Parent' });
		const child = await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Child',
			parentId: parent.id,
		});

		await expect(setGroupTeamFolders(PROJECT_ID, GROUP_ID, [parent.id, child.id], ADMIN_ID)).rejects.toThrow(
			TeamFolderError,
		);
	});

	it('refuses to move a folder holding a team folder out of the open folders, and the team folder keeps its groups', async () => {
		const parent = await createFolder({ ownerId: OWNER_ID, projectId: PROJECT_ID, name: 'Parent' });
		await createFolder({
			ownerId: OWNER_ID,
			projectId: PROJECT_ID,
			name: 'Sales',
			parentId: parent.id,
			groupIds: [GROUP_ID],
		});
		const privateRoot = await ensurePrivateRoot(MEMBER_ID, PROJECT_ID);

		await expect(moveFolder(MEMBER_ID, PROJECT_ID, parent.id, privateRoot)).rejects.toThrow(
			'contains a team folder',
		);
		expect(await visibleFolderNames(viewerOf(OUTSIDER_ID))).toEqual(['Parent']);
	});
});

async function visibleFolderNames(viewer: FolderViewer): Promise<string[]> {
	return (await listFolderTree(viewer, PROJECT_ID))
		.filter((folder) => !folder.systemType)
		.map((folder) => folder.name);
}

function viewerOf(userId: string, groupIds: string[] = [], isAdmin = false): FolderViewer {
	return { userId, isAdmin, isViewer: false, groupIds: new Set(groupIds) };
}
