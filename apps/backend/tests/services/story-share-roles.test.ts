import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	getSharedStoryByStoryId,
	getSharedStoryInfo,
	getStoryShareRole,
	updateSharedStoryGeneralAccess,
} from '../../src/queries/shared-story.queries';
import { getStoryById } from '../../src/queries/story.queries';
import { setStoryFolder } from '../../src/queries/story-folder.queries';
import { getReferenceableStory } from '../../src/queries/story-reference.queries';
import { ensureStoryChat } from '../../src/services/editable-story';
import { notifySharedItem } from '../../src/services/notification.service';
import { assertCanShareWith } from '../../src/services/project-sharing.service';
import {
	assertCanManageStoryShare,
	getStoryShareSettings,
	saveStoryShareSettings,
	type ShareActor,
	type StoryShareChange,
} from '../../src/services/story-share-settings.service';

const mocks = vi.hoisted(() => ({
	attachChatToStandaloneStory: vi.fn(),
	storyFolderId: null as string | null,
}));

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/notification.service', () => ({ notifySharedItem: vi.fn(async () => undefined) }));
vi.mock('../../src/services/project-sharing.service', () => ({
	assertCanShareToProject: vi.fn(),
	assertCanShareWith: vi.fn(),
}));
vi.mock('../../src/services/shareable-user-groups.service', () => ({ assertShareableUserGroupIds: vi.fn() }));
vi.mock('../../src/queries/story-folder.queries', () => ({
	ensurePrivateRoot: vi.fn(async () => PRIVATE_FOLDER_ID),
	ensureStoryPrivate: vi.fn(),
	getLastUsedFolderId: vi.fn(async () => null),
	getStoryFolderItem: vi.fn(async () => (mocks.storyFolderId ? { folderId: mocks.storyFolderId } : null)),
	resolveFolderAudience: vi.fn(async (folderId: string | null) => {
		if (folderId === PRIVATE_FOLDER_ID) {
			return { kind: 'private' };
		}
		return folderId === TEAM_FOLDER_ID ? { kind: 'groups', groupIds: [GROUP_ID] } : { kind: 'project' };
	}),
	setStoryFolder: vi.fn(async (_storyId: string, folderId: string | null) => {
		mocks.storyFolderId = folderId;
	}),
	withProjectFolderLock: (_projectId: string, work: () => Promise<unknown>) => work(),
}));
vi.mock('../../src/services/story-delivery.service', () => ({ teardownStoryDelivery: vi.fn() }));
vi.mock('../../src/services/standalone-story', () => ({
	attachChatToStandaloneStory: mocks.attachChatToStandaloneStory,
}));

const PROJECT_ID = 'roles-project';
const OWNER_ID = 'roles-owner';
const EDITOR_ID = 'roles-editor';
const VIEWER_ID = 'roles-viewer';
const GROUP_MEMBER_ID = 'roles-group-member';
const OUTSIDER_ID = 'roles-outsider';
const PROJECT_VIEWER_ID = 'roles-project-viewer';
const GROUP_ID = 'roles-group';
const STORY_ID = 'roles-story';
const PRIVATE_FOLDER_ID = 'roles-private-folder';
const TEAM_FOLDER_ID = 'roles-team-folder';

const OWNER: ShareActor = { id: OWNER_ID, name: 'Owner', role: 'user', projectId: PROJECT_ID };

describe('story edit rights shared through roles', () => {
	beforeAll(seed);

	beforeEach(async () => {
		await db.delete(s.sharedStory);
		vi.clearAllMocks();
		mocks.storyFolderId = PRIVATE_FOLDER_ID;
	});

	afterAll(() => {
		db.$client.close();
	});

	it('lets only the owner edit a story that is not shared', async () => {
		expect(await canEdit(OWNER_ID)).toBe(true);
		expect(await getReferenceableStory(EDITOR_ID, PROJECT_ID, STORY_ID)).toBeNull();
	});

	it('shares with the people chosen and lets editors, not viewers, edit', async () => {
		await save({ users: [editor(EDITOR_ID), viewer(VIEWER_ID)] });

		expect((await getSharedStoryInfo(STORY_ID, PROJECT_ID))?.visibility).toBe('specific');
		expect(await canEdit(EDITOR_ID)).toBe(true);
		expect(await canEdit(VIEWER_ID)).toBe(false);
		expect(await getStoryShareRole(STORY_ID, EDITOR_ID)).toBe('editor');
		expect(await getStoryShareRole(STORY_ID, VIEWER_ID)).toBe('viewer');
		expect(await getStoryShareRole(STORY_ID, OUTSIDER_ID)).toBeNull();
	});

	it('gives the members of an editor group the right to edit', async () => {
		await save({ groups: [editor(GROUP_ID)] });

		expect(await canEdit(GROUP_MEMBER_ID)).toBe(true);
	});

	it("lets a person's own role win over their group's role", async () => {
		await save({ users: [viewer(GROUP_MEMBER_ID)], groups: [editor(GROUP_ID)] });

		expect(await canEdit(GROUP_MEMBER_ID)).toBe(false);
	});

	it('lets every project member edit when the whole project is an editor', async () => {
		await save({ visibility: 'project', projectRole: 'viewer' });
		expect(await canEdit(OUTSIDER_ID)).toBe(false);

		await save({ visibility: 'project', projectRole: 'editor' });
		expect(await canEdit(OUTSIDER_ID)).toBe(true);
	});

	it('lets a person keep a different role than the rest of the project, both ways', async () => {
		await save({ visibility: 'project', projectRole: 'editor', users: [viewer(VIEWER_ID)] });
		expect(await canEdit(VIEWER_ID)).toBe(false);
		expect(await canEdit(OUTSIDER_ID)).toBe(true);

		await save({ visibility: 'project', projectRole: 'viewer', users: [editor(EDITOR_ID)] });
		expect(await canEdit(EDITOR_ID)).toBe(true);
		expect(await canEdit(OUTSIDER_ID)).toBe(false);
	});

	it('keeps a project-wide share free of group roles, which its settings do not show', async () => {
		await save({ visibility: 'project', projectRole: 'viewer', groups: [editor(GROUP_ID)] });

		expect(await canEdit(GROUP_MEMBER_ID)).toBe(false);
		expect((await getStoryShareSettings(await story(), OWNER)).groups).toEqual([]);
	});

	it('ignores a group role left on a project-wide share by an earlier save', async () => {
		await save({ groups: [editor(GROUP_ID)] });
		await updateSharedStoryGeneralAccess(await shareId(), { visibility: 'project', projectRole: 'viewer' });

		expect(await canEdit(GROUP_MEMBER_ID)).toBe(false);
	});

	it('replaces the people and roles with the saved ones', async () => {
		await save({ users: [editor(EDITOR_ID), viewer(VIEWER_ID)] });

		await save({ users: [editor(VIEWER_ID)] });

		expect(await canEdit(VIEWER_ID)).toBe(true);
		expect(await getStoryShareRole(STORY_ID, EDITOR_ID)).toBeNull();
	});

	it('tells new recipients what they can do with the story', async () => {
		await save({ users: [editor(EDITOR_ID), viewer(VIEWER_ID)] });

		expect(notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ allowedUserIds: [EDITOR_ID], role: 'editor' }),
		);
		expect(notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ allowedUserIds: [VIEWER_ID], role: 'viewer' }),
		);
	});

	it('tells someone who could only read the story that they can now edit it', async () => {
		await save({ users: [viewer(VIEWER_ID), viewer(EDITOR_ID)] });
		vi.mocked(notifySharedItem).mockClear();

		await save({ users: [editor(VIEWER_ID), viewer(EDITOR_ID)] });

		expect(notifySharedItem).toHaveBeenCalledOnce();
		expect(notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ allowedUserIds: [VIEWER_ID], role: 'editor', isRoleChange: true }),
		);
	});

	it('tells the project, except people kept as viewers, that everyone can now edit the story', async () => {
		await save({ visibility: 'project', projectRole: 'viewer', users: [viewer(VIEWER_ID)] });
		vi.mocked(notifySharedItem).mockClear();

		await save({ visibility: 'project', projectRole: 'editor', users: [viewer(VIEWER_ID)] });

		expect(notifySharedItem).toHaveBeenCalledOnce();
		const [notification] = vi.mocked(notifySharedItem).mock.calls[0];
		expect(notification).toMatchObject({ role: 'editor', isRoleChange: true });
		expect([...(notification.allowedUserIds ?? [])].sort()).toEqual(
			[EDITOR_ID, GROUP_MEMBER_ID, OUTSIDER_ID].sort(),
		);
	});

	it('never lets a project viewer edit, whatever role the share gives them', async () => {
		await save({ users: [editor(PROJECT_VIEWER_ID)] });
		expect(await canEdit(PROJECT_VIEWER_ID)).toBe(false);
		expect(await getStoryShareRole(STORY_ID, PROJECT_VIEWER_ID)).toBe('viewer');

		await save({ visibility: 'project', projectRole: 'editor' });
		expect(await canEdit(PROJECT_VIEWER_ID)).toBe(false);
		expect(await canEdit(OUTSIDER_ID)).toBe(true);
	});

	it('tells someone who reads the story through the project that they can now edit it', async () => {
		await save({ visibility: 'project', projectRole: 'viewer', users: [] });
		vi.mocked(notifySharedItem).mockClear();

		await save({ visibility: 'project', projectRole: 'viewer', users: [editor(VIEWER_ID)] });

		expect(notifySharedItem).toHaveBeenCalledOnce();
		expect(notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ allowedUserIds: [VIEWER_ID], role: 'editor', isRoleChange: true }),
		);
	});

	it('never adds the owner as a recipient', async () => {
		await save({ users: [editor(OWNER_ID), editor(EDITOR_ID)] });

		const settings = await getStoryShareSettings(await story(), OWNER);
		expect(settings.owner?.id).toBe(OWNER_ID);
		expect(settings.users.map((user) => user.id)).toEqual([EDITOR_ID]);
	});

	it('lists who has access with their role', async () => {
		await save({ users: [editor(EDITOR_ID)], groups: [viewer(GROUP_ID)] });

		const settings = await getStoryShareSettings(await story(), OWNER);

		expect(settings).toMatchObject({
			canManage: true,
			isShared: true,
			visibility: 'specific',
			users: [{ id: EDITOR_ID, role: 'editor' }],
			groups: [{ id: GROUP_ID, name: 'Analysts', memberCount: 1, role: 'viewer' }],
		});
		expect((await getStoryShareSettings(await story(), { ...OWNER, id: EDITOR_ID })).canManage).toBe(false);
	});

	it('shows who has access only to people who can open the story', async () => {
		await expect(getStoryShareSettings(await story(), { ...OWNER, id: VIEWER_ID })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});

		await save({ users: [editor(EDITOR_ID)] });

		await expect(getStoryShareSettings(await story(), { ...OWNER, id: OUTSIDER_ID })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect((await getStoryShareSettings(await story(), { ...OWNER, id: EDITOR_ID })).users).toHaveLength(1);
		expect(
			(await getStoryShareSettings(await story(), { ...OWNER, id: OUTSIDER_ID, role: 'admin' })).canManage,
		).toBe(true);
	});

	it('only checks the people a save adds, not those already on the share', async () => {
		await save({ users: [editor(EDITOR_ID)] });
		vi.mocked(assertCanShareWith).mockClear();

		await save({ users: [editor(EDITOR_ID), viewer(VIEWER_ID)] });

		expect(assertCanShareWith).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, { userIds: [VIEWER_ID], groupIds: [] });
	});

	it('moves the story only when its folder stops matching who it is shared with', async () => {
		await save({ visibility: 'project' });
		expect(mocks.storyFolderId).toBeNull();

		await save({ visibility: 'project', projectRole: 'editor' });
		expect(setStoryFolder).toHaveBeenCalledOnce();

		await save({ users: [editor(EDITOR_ID)] });
		expect(mocks.storyFolderId).toBe(PRIVATE_FOLDER_ID);
	});

	it('keeps the people chosen when a story leaves a team folder it no longer fits', async () => {
		mocks.storyFolderId = TEAM_FOLDER_ID;
		await save({ users: [viewer(VIEWER_ID)], groups: [viewer(GROUP_ID)] });
		expect(mocks.storyFolderId).toBe(TEAM_FOLDER_ID);

		await save({ users: [viewer(VIEWER_ID)] });

		expect(mocks.storyFolderId).toBe(PRIVATE_FOLDER_ID);
		expect(await getStoryShareRole(STORY_ID, VIEWER_ID)).toBe('viewer');
		expect(await getStoryShareRole(STORY_ID, GROUP_MEMBER_ID)).toBeNull();
	});

	it('lets only the owner or an admin change who has access, never an editor', async () => {
		await save({ users: [editor(EDITOR_ID)] });

		await expect(assertCanManageStoryShare(await story(), { ...OWNER, id: EDITOR_ID })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(assertCanManageStoryShare(await story(), OWNER)).resolves.toBeUndefined();
	});

	it('keeps the owner as the author and sharer when an admin shares their story', async () => {
		await save({ visibility: 'project' }, { ...OWNER, id: OUTSIDER_ID, role: 'admin' });

		expect(await getSharedStoryByStoryId(STORY_ID)).toMatchObject({ userId: OWNER_ID, authorName: OWNER_ID });
	});

	it('unshares the story when it is limited to nobody', async () => {
		await save({ visibility: 'project' });

		await save({});

		expect(await getSharedStoryInfo(STORY_ID, PROJECT_ID)).toBeNull();
	});

	it('attaches the chat of a standalone story to its owner when an editor edits it first', async () => {
		mocks.attachChatToStandaloneStory.mockResolvedValue({ chatId: 'attached-chat' });

		await ensureStoryChat(await story(), { userId: EDITOR_ID, projectId: PROJECT_ID, chatId: 'editor-chat' });

		expect(mocks.attachChatToStandaloneStory).toHaveBeenCalledWith(expect.objectContaining({ id: STORY_ID }), {
			userId: OWNER_ID,
			projectId: PROJECT_ID,
		});
	});
});

async function canEdit(userId: string): Promise<boolean | undefined> {
	return (await getReferenceableStory(userId, PROJECT_ID, STORY_ID))?.canEdit;
}

async function save(change: Partial<StoryShareChange>, actor: ShareActor = OWNER) {
	await saveStoryShareSettings(await story(), actor, {
		visibility: 'specific',
		projectRole: 'viewer',
		users: [],
		groups: [],
		notify: false,
		...change,
	});
}

function editor(id: string) {
	return { id, role: 'editor' as const };
}

function viewer(id: string) {
	return { id, role: 'viewer' as const };
}

async function shareId(): Promise<string> {
	const share = await getSharedStoryInfo(STORY_ID, PROJECT_ID);
	if (!share) {
		throw new Error('The story is not shared.');
	}
	return share.id;
}

async function story() {
	const row = await getStoryById(STORY_ID);
	if (!row) {
		throw new Error('The seeded story is missing.');
	}
	return row;
}

async function seed() {
	await db.insert(s.user).values(
		[OWNER_ID, EDITOR_ID, VIEWER_ID, GROUP_MEMBER_ID, OUTSIDER_ID, PROJECT_VIEWER_ID].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
		})),
	);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Roles', type: 'local', path: '/tmp/roles' });
	await db.insert(s.projectMember).values([
		...[OWNER_ID, EDITOR_ID, VIEWER_ID, GROUP_MEMBER_ID, OUTSIDER_ID].map((userId) => ({
			projectId: PROJECT_ID,
			userId,
			role: 'user' as const,
		})),
		{ projectId: PROJECT_ID, userId: PROJECT_VIEWER_ID, role: 'viewer' as const },
	]);
	await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Analysts' });
	await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: GROUP_MEMBER_ID });
	await db.insert(s.story).values({
		id: STORY_ID,
		slug: STORY_ID,
		projectId: PROJECT_ID,
		userId: OWNER_ID,
		title: 'Quarterly revenue',
	});
	await db
		.insert(s.storyVersion)
		.values({ storyId: STORY_ID, version: 1, code: '# Revenue', action: 'create', source: 'assistant' });
}
