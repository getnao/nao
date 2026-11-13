import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { createForkedChat, deleteChat } from '../../src/queries/chat.queries';
import { getSharedStoryInfo, getStoryShareRole } from '../../src/queries/shared-story.queries';
import {
	canUserAccessStory,
	findStoryTransferredOutOfChat,
	getStoryById,
	getStoryDataCacheByStoryId,
	getStoryOwnerId,
	listOwnedStoryIdsInProject,
	listStoriesInChat,
} from '../../src/queries/story.queries';
import { notifyStoryTransfer } from '../../src/services/notification.service';
import { acquireStoryEditLock, releaseStoryEditLock } from '../../src/services/story-edit-lock.service';
import type { ShareActor } from '../../src/services/story-share-settings.service';
import { StoryTransferError, transferAllStoriesOfUser, transferStory } from '../../src/services/story-transfer.service';
import { buildQueryDataMessages } from '../../src/utils/chat-message-story';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/notification.service', () => ({
	notifySharedItem: vi.fn(async () => undefined),
	notifyStoryTransfer: vi.fn(async () => undefined),
}));
vi.mock('../../src/services/project-sharing.service', async () => {
	const projectQueries = await import('../../src/queries/project.queries');
	return {
		assertCanShareToProject: vi.fn(),
		assertCanShareWith: vi.fn(),
		listShareableMembers: projectQueries.listUsersWithProjectAccess,
	};
});
vi.mock('../../src/services/shareable-user-groups.service', () => ({ assertShareableUserGroupIds: vi.fn() }));

const PROJECT_ID = 'transfer-project';
const OWNER_ID = 'transfer-owner';
const LEAVER_ID = 'transfer-leaver';
const RECIPIENT_ID = 'transfer-recipient';
const ADMIN_ID = 'transfer-admin';
const VIEWER_ID = 'transfer-viewer';
const OWNER_STORY_ID = 'transfer-owner-story';
const LEAVER_CHAT_STORY_ID = 'transfer-leaver-chat-story';
const LEAVER_STANDALONE_STORY_ID = 'transfer-leaver-standalone-story';
const ADMIN_STORY_ID = 'transfer-admin-story';
const RECIPIENT_STORY_ID = 'transfer-recipient-story';
const QUERY_ID = 'query_revenue';
const QUERY_SQL = 'select month, revenue from sales';
const ROWS = { data: [{ month: 'Jan', revenue: 10 }], columns: ['month', 'revenue'] };
const STORY_CODE = `# Revenue\n\n<chart query_id="${QUERY_ID}" chart_type="bar" x_axis_key="month" />\n`;

const OWNER: ShareActor = { id: OWNER_ID, name: 'Owner', role: 'user', projectId: PROJECT_ID };
const ADMIN: ShareActor = { id: ADMIN_ID, name: 'Admin', role: 'admin', projectId: PROJECT_ID };

let ownerChatId = '';
let leaverChatId = '';

describe('transferring story ownership', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('makes the story a standalone story of its new owner, frozen with its rows, out of reach of the previous owner', async () => {
		await transferStory(OWNER_STORY_ID, RECIPIENT_ID, OWNER);

		const story = await getStoryById(OWNER_STORY_ID);
		expect(story).toMatchObject({ chatId: null, userId: RECIPIENT_ID, projectId: PROJECT_ID, isLive: false });
		expect((await getStoryDataCacheByStoryId(OWNER_STORY_ID))?.queryData).toEqual({ [QUERY_ID]: ROWS });
		expect(await listOwnedStoryIdsInProject(RECIPIENT_ID, PROJECT_ID)).toContain(OWNER_STORY_ID);
		expect(await listOwnedStoryIdsInProject(OWNER_ID, PROJECT_ID)).toEqual([]);
		expect(await canUserAccessStory(OWNER_STORY_ID, OWNER_ID)).toBe(false);
		expect(await findStoryTransferredOutOfChat(ownerChatId, 'revenue')).toMatchObject({ id: OWNER_STORY_ID });
		expect(await getStoryShareRole(OWNER_STORY_ID, OWNER_ID)).toBeNull();
		expect(notifyStoryTransfer).toHaveBeenCalledWith(
			expect.objectContaining({ recipientId: RECIPIENT_ID, stories: [{ id: OWNER_STORY_ID, title: 'Revenue' }] }),
		);
	});

	it("keeps a handed-over story when the previous owner's chat is deleted", async () => {
		await deleteChat(ownerChatId);

		expect(await getStoryOwnerId(OWNER_STORY_ID)).toBe(RECIPIENT_ID);
	});

	it('refuses to hand over a story someone is editing, and leaves it untouched', async () => {
		const editor = { userId: RECIPIENT_ID, chatId: null, sessionId: 'tab' };
		await acquireStoryEditLock(ADMIN_STORY_ID, editor);

		await expect(transferStory(ADMIN_STORY_ID, OWNER_ID, ADMIN)).rejects.toThrow(StoryTransferError);
		expect(await getStoryOwnerId(ADMIN_STORY_ID)).toBe(ADMIN_ID);
		expect(await getSharedStoryInfo(ADMIN_STORY_ID, PROJECT_ID)).toBeNull();

		await releaseStoryEditLock(ADMIN_STORY_ID, editor);
	});

	it('refuses to hand a story to a member who cannot edit', async () => {
		await expect(transferStory(ADMIN_STORY_ID, VIEWER_ID, ADMIN)).rejects.toThrow(StoryTransferError);
		expect(await getStoryOwnerId(ADMIN_STORY_ID)).toBe(ADMIN_ID);
	});

	it("hands every story of a leaving member to the recipient, and nobody else's, without slug clashes", async () => {
		const result = await transferAllStoriesOfUser(LEAVER_ID, RECIPIENT_ID, ADMIN);

		expect(result).toEqual({ transferredCount: 2, failedCount: 0 });
		expect(await listOwnedStoryIdsInProject(LEAVER_ID, PROJECT_ID)).toEqual([]);
		expect(await listStoriesInChat(leaverChatId)).toEqual([]);
		expect(await getStoryOwnerId(LEAVER_STANDALONE_STORY_ID)).toBe(RECIPIENT_ID);
		expect(await getStoryOwnerId(ADMIN_STORY_ID)).toBe(ADMIN_ID);
		expect(await getSharedStoryInfo(LEAVER_STANDALONE_STORY_ID, PROJECT_ID)).toBeNull();
		const slugs = await Promise.all(
			[RECIPIENT_STORY_ID, OWNER_STORY_ID, LEAVER_CHAT_STORY_ID, LEAVER_STANDALONE_STORY_ID].map(
				async (storyId) => (await getStoryById(storyId))?.slug,
			),
		);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(notifyStoryTransfer).toHaveBeenLastCalledWith(
			expect.objectContaining({ recipientId: RECIPIENT_ID, previousOwnerId: LEAVER_ID }),
		);
	});
});

async function seed() {
	await db.insert(s.user).values(
		[OWNER_ID, LEAVER_ID, RECIPIENT_ID, ADMIN_ID, VIEWER_ID].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
		})),
	);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Transfer', type: 'local', path: '/tmp/transfer' });
	await db.insert(s.projectMember).values([
		...[OWNER_ID, LEAVER_ID, RECIPIENT_ID].map((userId) => ({
			projectId: PROJECT_ID,
			userId,
			role: 'user' as const,
		})),
		{ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'admin' as const },
		{ projectId: PROJECT_ID, userId: VIEWER_ID, role: 'viewer' as const },
	]);

	ownerChatId = await seedChatStory(OWNER_ID, OWNER_STORY_ID);
	leaverChatId = await seedChatStory(LEAVER_ID, LEAVER_CHAT_STORY_ID);
	await seedStandaloneStory(LEAVER_ID, LEAVER_STANDALONE_STORY_ID);
	await seedStandaloneStory(ADMIN_ID, ADMIN_STORY_ID);
	await seedStandaloneStory(RECIPIENT_ID, RECIPIENT_STORY_ID);
}

async function seedChatStory(userId: string, storyId: string): Promise<string> {
	const chat = await createForkedChat(
		{ projectId: PROJECT_ID, userId, title: 'Revenue analysis' },
		buildQueryDataMessages({ [QUERY_ID]: ROWS }, { [QUERY_ID]: { sqlQuery: QUERY_SQL } }),
	);
	await db.insert(s.story).values({ id: storyId, chatId: chat.id, slug: 'revenue', title: 'Revenue', isLive: true });
	await seedVersion(storyId);
	return chat.id;
}

async function seedStandaloneStory(userId: string, storyId: string): Promise<void> {
	await db.insert(s.story).values({ id: storyId, projectId: PROJECT_ID, userId, slug: 'revenue', title: 'Revenue' });
	await seedVersion(storyId);
	await db.insert(s.storyDataCache).values({ storyId, queryData: { [QUERY_ID]: ROWS } });
}

async function seedVersion(storyId: string): Promise<void> {
	await db
		.insert(s.storyVersion)
		.values({ storyId, version: 1, code: STORY_CODE, action: 'create', source: 'assistant' });
}
