import { extractQueryIds } from '@nao/shared/story-segments';

import type { DBStory } from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import type { UserWithRole } from '../types/project';
import type { StoryQueryDataMap } from '../utils/chat-message-story';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { agentService } from './agent';
import { notifyStoryTransfer } from './notification.service';
import { listShareableMembers } from './project-sharing.service';
import { syncStoryDeliveryJob } from './story-delivery.service';
import { freeStandaloneSlug, pickShownNarratives } from './story-duplicate';
import { acquireStoryEditLock, releaseStoryEditLock, StoryEditLockedError } from './story-edit-lock.service';
import { assertCanManageStoryShare, type ShareActor } from './story-share-settings.service';

const TRANSFER_LOCK_SESSION_ID = 'story-transfer';

export class StoryTransferError extends Error {}

export interface BulkStoryTransferResult {
	transferredCount: number;
	failedCount: number;
}

type StoryRecipient = Pick<UserWithRole, 'id' | 'name' | 'email'>;

interface Handover {
	storyId: string;
	previousOwnerId: string;
	recipientId: string;
	projectId: string;
}

interface StorySnapshot {
	queryData: StoryQueryDataMap;
	narratives: Record<string, string> | null;
}

/**
 * Hands a story over to another member. It leaves the previous owner's chat and becomes a standalone story of its
 * new owner, frozen with the rows of every version: it keeps its shares, versions and settings, but is no longer live.
 * The previous owner keeps access only through the story's shares.
 */
export async function transferStory(storyId: string, recipientId: string, actor: ShareActor): Promise<void> {
	const recipient = await findRecipient(actor, recipientId);
	const story = await handOverStory(storyId, recipient, actor);
	await notifyRecipient(actor, recipientId, [story]);
}

/** Hands every story a member owns in the project to another one, e.g. when they leave or are away for long. */
export async function transferAllStoriesOfUser(
	fromUserId: string,
	recipientId: string,
	actor: ShareActor,
): Promise<BulkStoryTransferResult> {
	const recipient = await findRecipient(actor, recipientId);
	if (recipient.id === fromUserId) {
		throw new StoryTransferError('This member already owns these stories.');
	}
	const storyIds = await storyQueries.listOwnedStoryIdsInProject(fromUserId, actor.projectId);
	const transferred: DBStory[] = [];
	for (const storyId of storyIds) {
		try {
			transferred.push(await handOverStory(storyId, recipient, actor));
		} catch (error) {
			logger.warn(`Failed to transfer story: ${String(error)}`, {
				source: 'system',
				projectId: actor.projectId,
				context: { storyId, fromUserId, recipientId },
			});
		}
	}
	await notifyRecipient(actor, recipientId, transferred, fromUserId);
	return { transferredCount: transferred.length, failedCount: storyIds.length - transferred.length };
}

/** Members who can edit, and whom the actor could share with, can take a story over. */
export async function listStoryRecipients(actor: ShareActor, ownerId: string): Promise<StoryRecipient[]> {
	return (await listEditingMembers(actor)).filter((member) => member.id !== ownerId);
}

async function handOverStory(storyId: string, recipient: StoryRecipient, actor: ShareActor): Promise<DBStory> {
	return withKeyedLock(`story:${storyId}`, async () => {
		const story = await storyQueries.getStoryById(storyId);
		if (!story) {
			throw new StoryTransferError('Story not found.');
		}
		await assertCanManageStoryShare(story, actor);
		const previousOwnerId = await storyQueries.getStoryOwnerId(story.id);
		if (!previousOwnerId || previousOwnerId === recipient.id) {
			throw new StoryTransferError('This member already owns the story.');
		}

		const handover = { storyId: story.id, previousOwnerId, recipientId: recipient.id, projectId: actor.projectId };
		await whileNobodyEdits(story, actor.id, () => moveToRecipient(story, handover));
		return story;
	});
}

async function moveToRecipient(story: DBStory, handover: Handover): Promise<void> {
	const owner = { userId: handover.recipientId, projectId: handover.projectId };
	const snapshot = story.chatId ? await loadChatSnapshot(story, story.chatId) : null;
	const slug = await freeStandaloneSlug(owner, story.slug);
	await db.transaction(async (tx) => {
		if (!(await storyQueries.detachStoryToOwner(story, { ...owner, slug }, tx))) {
			throw new StoryTransferError('The story changed while it was being transferred. Try again.');
		}
		if (snapshot) {
			await storyQueries.upsertStoryDataCacheByStoryId(story.id, snapshot.queryData, snapshot.narratives, tx);
		}
		await handOverShare(handover, tx);
		await handOverPrivateFolder(handover, tx);
	});
	await stopScheduledJobs(story);
}

async function notifyRecipient(
	actor: ShareActor,
	recipientId: string,
	stories: DBStory[],
	previousOwnerId?: string,
): Promise<void> {
	if (stories.length === 0 || recipientId === actor.id) {
		return;
	}
	await notifyStoryTransfer({
		projectId: actor.projectId,
		recipientId,
		senderName: actor.name,
		stories: stories.map(({ id, title }) => ({ id, title })),
		previousOwnerId,
	}).catch((error) => {
		logger.error(`Failed to notify the new owner of a story transfer: ${String(error)}`, {
			source: 'system',
			projectId: actor.projectId,
			context: { recipientId },
		});
	});
}

async function findRecipient(actor: ShareActor, recipientId: string): Promise<StoryRecipient> {
	const recipient = (await listEditingMembers(actor)).find((member) => member.id === recipientId);
	if (!recipient) {
		throw new StoryTransferError('Stories can only be handed to project members who can edit them.');
	}
	return recipient;
}

async function listEditingMembers(actor: ShareActor): Promise<StoryRecipient[]> {
	const members =
		actor.role === 'admin'
			? await projectQueries.listUsersWithProjectAccess(actor.projectId)
			: await listShareableMembers(actor.projectId, actor.id);
	return members.filter((member) => member.role !== 'viewer').map(({ id, name, email }) => ({ id, name, email }));
}

/** Holds the story's edit lock while it changes hands, so no editor or agent saves it halfway through. */
async function whileNobodyEdits<T>(story: DBStory, userId: string, run: () => Promise<T>): Promise<T> {
	if (story.chatId && agentService.get(story.chatId)) {
		throw new StoryTransferError('The agent is working on this story. Try again once it is done.');
	}
	const holder = { userId, chatId: null, sessionId: TRANSFER_LOCK_SESSION_ID };
	try {
		await acquireStoryEditLock(story.id, holder);
	} catch (error) {
		throw error instanceof StoryEditLockedError ? new StoryTransferError(error.message) : error;
	}
	try {
		return await run();
	} finally {
		await releaseStoryEditLock(story.id, holder);
	}
}

/** Freezes the rows the story shows today, and those of its older versions so restoring one still shows its data. */
async function loadChatSnapshot(story: DBStory, chatId: string): Promise<StorySnapshot> {
	const [cache, queryIds] = await Promise.all([
		storyQueries.getStoryDataCacheByStoryId(story.id),
		listStoryQueryIds(story),
	]);
	const cached = (cache?.queryData as StoryQueryDataMap | undefined) ?? {};
	const fromChat = await executeSqlQueries.getLatestSqlQueryDataByIds(chatId, queryIds);
	return {
		queryData: story.isLive ? { ...fromChat, ...cached } : { ...cached, ...fromChat },
		narratives: pickShownNarratives(story, cache),
	};
}

/** Every version and the draft keep their rows, so restoring an older version still shows its data. */
async function listStoryQueryIds(story: DBStory): Promise<Set<string>> {
	const versions = await storyQueries.listStoryVersionsByStoryId(story.id);
	if (story.format !== 'custom') {
		return new Set(versions.flatMap((version) => [...extractQueryIds(version.code)]));
	}
	const [versionFiles, draftFiles] = await Promise.all([
		storyFileQueries.listFilesOfVersions(versions.map((version) => version.id)),
		storyFileQueries.listDraftFiles(story.id),
	]);
	return extractCustomStoryQueryIds([...versionFiles, ...draftFiles]);
}

/** A story that is no longer live stops refreshing and stops being delivered. */
async function stopScheduledJobs(story: DBStory): Promise<void> {
	if (story.scheduledJobId) {
		await scheduledJobQueries.deleteJob(story.scheduledJobId);
	}
	await syncStoryDeliveryJob(story.id, false, null);
}

/** The new owner becomes the sharer, so the share no longer disappears with the previous owner's account. */
async function handOverShare(handover: Handover, tx: DBTransaction): Promise<void> {
	const { storyId, recipientId, projectId } = handover;
	if (!(await sharedStoryQueries.getSharedStoryInfo(storyId, projectId, tx))) {
		return;
	}
	const shareId = await sharedStoryQueries.setSharedStorySharer(storyId, projectId, recipientId, tx);
	await sharedStoryQueries.removeSharedStoryRecipients(shareId, { userIds: [recipientId], groupIds: [] }, tx);
}

/** A story filed in the previous owner's private folders moves to the new owner's; one in a shared folder stays. */
async function handOverPrivateFolder(handover: Handover, tx: DBTransaction): Promise<void> {
	const { storyId, previousOwnerId, recipientId, projectId } = handover;
	const item = await storyFolderQueries.getStoryFolderItem(storyId, tx);
	const folder = item ? await storyFolderQueries.getFolderById(item.folderId, tx) : null;
	if (folder?.ownerId !== previousOwnerId || folder.visibility !== 'private') {
		return;
	}
	const privateRootId = await storyFolderQueries.ensurePrivateRoot(recipientId, projectId, tx);
	await storyFolderQueries.moveStoryToFolder(storyId, privateRootId, { storyOwnerId: recipientId, projectId }, tx);
}
