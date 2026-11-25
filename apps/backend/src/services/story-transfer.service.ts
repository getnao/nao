import { extractQueryIds } from '@nao/shared/story-segments';

import type { DBStory } from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import type { StoryEditHolder } from '../queries/story-edit-lock.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import type { UserWithRole } from '../types/project';
import { fromPromise, runEffect, withHeartbeat } from '../utils/effect-runtime';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { agentService } from './agent';
import { notifyStoryTransfer } from './notification.service';
import { listShareableMembers } from './project-sharing.service';
import { freeStandaloneSlug, loadSnapshot } from './story-duplicate';
import {
	acquireStoryEditLock,
	releaseStoryEditLock,
	renewStoryEditLock,
	STORY_EDIT_LOCK_RENEW_MS,
	StoryEditLockedError,
} from './story-edit-lock.service';
import { syncStoryScheduledJobs } from './story-refresh.service';
import { assertCanManageStoryShare, type ShareActor } from './story-share-settings.service';
import { copyStoryQueries } from './story-sql-queries';
import {
	flagRecipientsWithTableAccess,
	hasTableAccessOf,
	MISSING_TABLE_ACCESS_MESSAGE,
} from './user-group-context-access.service';

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

/**
 * Hands a story over to another member. It leaves the previous owner's chat and becomes a standalone story of its
 * new owner, with the SQL and rows of every version: it keeps its shares, versions and live settings.
 * The previous owner keeps access only through the story's shares.
 */
export async function transferStory(storyId: string, recipientId: string, actor: ShareActor): Promise<void> {
	const recipient = await findRecipient(actor, recipientId);
	const story = await handOverStory(storyId, recipient, actor);
	if (story) {
		await notifyRecipient(actor, recipientId, [story]);
	}
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
	await assertHasTableAccessOf(actor.projectId, fromUserId, recipient.id);
	const storyIds = await storyQueries.listOwnedStoryIdsInProject(fromUserId, actor.projectId);
	const transferred: DBStory[] = [];
	let failedCount = 0;
	for (const storyId of storyIds) {
		try {
			const story = await handOverStory(storyId, recipient, actor, fromUserId);
			if (story) {
				transferred.push(story);
			}
		} catch (error) {
			failedCount++;
			logger.warn(`Failed to transfer story: ${String(error)}`, {
				source: 'system',
				projectId: actor.projectId,
				context: { storyId, fromUserId, recipientId },
			});
		}
	}
	await notifyRecipient(actor, recipientId, transferred, fromUserId);
	return { transferredCount: transferred.length, failedCount };
}

/** Members who can edit, and whom the actor could share with, can take a story over. */
export async function listStoryRecipients(
	actor: ShareActor,
	ownerId: string,
): Promise<Array<StoryRecipient & { hasTableAccess: boolean }>> {
	const recipients = (await listEditingMembers(actor)).filter((member) => member.id !== ownerId);
	return flagRecipientsWithTableAccess(actor.projectId, ownerId, recipients);
}

/** Where a story that left this chat went, and whether the user can still open it there. */
export async function describeTransferredStory(
	chatId: string,
	storySlug: string,
	userId: string,
): Promise<{ ownerName: string; storyId: string | null } | null> {
	const transferred = await storyQueries.findStoryTransferredOutOfChat(chatId, storySlug);
	if (!transferred) {
		return null;
	}
	const canOpen = await storyQueries.canUserAccessStory(transferred.id, userId);
	return { ownerName: transferred.ownerName, storyId: canOpen ? transferred.id : null };
}

/**
 * With `expectedOwnerId`, a story someone else took over meanwhile is left alone and `null` is returned, and the
 * caller has already checked the recipient's table access against that owner.
 */
async function handOverStory(
	storyId: string,
	recipient: StoryRecipient,
	actor: ShareActor,
	expectedOwnerId?: string,
): Promise<DBStory | null> {
	return withKeyedLock(`story:${storyId}`, async () => {
		const story = await storyQueries.getStoryById(storyId);
		if (!story) {
			throw new StoryTransferError('Story not found.');
		}
		await assertCanManageStoryShare(story, actor);
		const previousOwnerId = await storyQueries.getStoryOwnerId(story.id);
		if (expectedOwnerId && previousOwnerId !== expectedOwnerId) {
			return null;
		}
		if (!previousOwnerId || previousOwnerId === recipient.id) {
			throw new StoryTransferError('This member already owns the story.');
		}
		if (!expectedOwnerId) {
			await assertHasTableAccessOf(actor.projectId, previousOwnerId, recipient.id);
		}

		const handover = { storyId: story.id, previousOwnerId, recipientId: recipient.id, projectId: actor.projectId };
		await whileNobodyEdits(story, actor.id, (lockHolder) => moveToRecipient(story, handover, lockHolder));
		return story;
	});
}

async function moveToRecipient(story: DBStory, handover: Handover, lockHolder: StoryEditHolder): Promise<void> {
	const owner = { userId: handover.recipientId, projectId: handover.projectId };
	const queryIds = story.chatId ? await listStoryQueryIds(story) : null;
	const snapshot = queryIds ? await loadSnapshot(story, queryIds) : null;
	await withKeyedLock(`standalone-slugs:${owner.projectId}:${owner.userId}`, async () => {
		const slug = await freeStandaloneSlug(owner, story.slug);
		await db.transaction(async (tx) => {
			if (
				!(await renewStoryEditLock(story.id, lockHolder, tx)) ||
				!(await storyQueries.detachStoryToOwner(story, { ...owner, slug }, tx))
			) {
				throw new StoryTransferError('The story changed while it was being transferred. Try again.');
			}
			if (queryIds) {
				await copyStoryQueries(story, story.id, queryIds, tx);
			}
			if (snapshot?.queryData || snapshot?.narratives) {
				await storyQueries.upsertStoryDataCacheByStoryId(
					story.id,
					snapshot.queryData ?? {},
					snapshot.narratives,
					null,
					tx,
				);
			}
			await handOverShare(handover, tx);
			await handOverPrivateFolder(handover, tx);
		});
	});
	await syncStoryScheduledJobs(story.id);
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

async function assertHasTableAccessOf(projectId: string, previousOwnerId: string, recipientId: string): Promise<void> {
	if (!(await hasTableAccessOf(projectId, previousOwnerId, recipientId))) {
		throw new StoryTransferError(MISSING_TABLE_ACCESS_MESSAGE);
	}
}

async function listEditingMembers(actor: ShareActor): Promise<StoryRecipient[]> {
	const members =
		actor.role === 'admin'
			? await projectQueries.listUsersWithProjectAccess(actor.projectId)
			: await listShareableMembers(actor.projectId, actor.id);
	return members.filter((member) => member.role !== 'viewer').map(({ id, name, email }) => ({ id, name, email }));
}

/**
 * Holds the story's edit lock while it changes hands, so no editor or agent saves it halfway through. Rerunning
 * live queries can outlast the lock, so it is renewed until the transfer ends.
 */
async function whileNobodyEdits<T>(
	story: DBStory,
	userId: string,
	run: (lockHolder: StoryEditHolder) => Promise<T>,
): Promise<T> {
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
		return await runEffect(
			fromPromise(() => run(holder)).pipe(
				withHeartbeat({
					name: 'Story edit lock renewal',
					beat: () => renewStoryEditLock(story.id, holder).catch(() => false),
					every: STORY_EDIT_LOCK_RENEW_MS,
				}),
			),
		);
	} finally {
		await releaseStoryEditLock(story.id, holder);
	}
}

/** Every version and the draft keep their SQL and rows, so restoring an older version still shows its data. */
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
