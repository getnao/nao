import { randomUUID } from 'node:crypto';

import type { StoryEditHolder } from '../queries/story-edit-lock.queries';
import * as storyEditLockQueries from '../queries/story-edit-lock.queries';

export const STORY_EDIT_LOCK_TTL_MS = 60_000;
export const STORY_EDIT_LOCK_RENEW_MS = 20_000;

const MCP_SESSION_PREFIX = 'mcp:';

/** `isMine` is the exact holder asking; `isYou` also covers the same person in another tab or chat. */
export type StoryEditLockState = {
	holderName: string;
	isMine: boolean;
	isYou: boolean;
	byAgent: boolean;
	byMcp: boolean;
} | null;

export class StoryEditLockedError extends Error {
	constructor(readonly holderName: string) {
		super(`${holderName} is editing this story. Try again once they are done.`);
		this.name = 'StoryEditLockedError';
	}
}

export async function acquireStoryEditLock(storyId: string, holder: StoryEditHolder): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		if (await storyEditLockQueries.tryAcquireStoryEditLock(storyId, holder, STORY_EDIT_LOCK_TTL_MS)) {
			return;
		}
		const lock = await storyEditLockQueries.getActiveStoryEditLock(storyId);
		if (lock) {
			throw new StoryEditLockedError(lock.userName);
		}
	}
	throw new StoryEditLockedError('Someone else');
}

/** Lets a change through unless someone other than `holder` is editing the story, whatever tab they save from. */
export async function assertStoryEditable(storyId: string, holder: StoryEditHolder): Promise<void> {
	const lock = await storyEditLockQueries.getActiveStoryEditLock(storyId);
	if (lock && !(lock.userId === holder.userId && lock.chatId === holder.chatId)) {
		throw new StoryEditLockedError(lock.userName);
	}
}

export async function getStoryEditLockState(storyId: string, viewer: StoryEditHolder): Promise<StoryEditLockState> {
	const lock = await storyEditLockQueries.getActiveStoryEditLock(storyId);
	if (!lock) {
		return null;
	}
	return {
		holderName: lock.userName,
		isMine:
			lock.userId === viewer.userId &&
			lock.chatId === viewer.chatId &&
			(lock.sessionId ?? null) === (viewer.sessionId ?? null),
		isYou: lock.userId === viewer.userId,
		byAgent: lock.chatId !== null,
		byMcp: lock.sessionId?.startsWith(MCP_SESSION_PREFIX) ?? false,
	};
}

export function newMcpStoryEditHolder(userId: string): StoryEditHolder {
	return { userId, chatId: null, sessionId: `${MCP_SESSION_PREFIX}${randomUUID()}` };
}

export async function releaseStoryEditLock(storyId: string, holder: StoryEditHolder): Promise<void> {
	await storyEditLockQueries.releaseStoryEditLock(storyId, holder);
}

/** Keeps the stories an agent run is editing locked while it thinks between two writes. */
export async function renewAgentStoryEditLocks(chatId: string): Promise<void> {
	await storyEditLockQueries.renewStoryEditLocksOfChat(chatId, STORY_EDIT_LOCK_TTL_MS);
}

/** An agent run that ends frees every story it was editing. */
export async function releaseAgentStoryEditLocks(chatId: string): Promise<void> {
	await storyEditLockQueries.releaseStoryEditLocksOfChat(chatId);
}
