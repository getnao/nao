import {
	MAX_STORY_STATE_KEYS,
	MAX_STORY_STATE_VALUE_BYTES,
	STORY_STATE_KEY_PATTERN,
	type StoryStateChange,
	type StoryStateSnapshot,
	type StoryStateValues,
} from '@nao/shared/story-app';

import type { DBStory, DBStoryAppState } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyAppStateQueries from '../queries/story-app-state.queries';
import * as userQueries from '../queries/user.queries';
import { CustomStoryNotFoundError } from './custom-story';

export class InvalidStoryStateError extends Error {}

/** The owner's saved state is the story's shared view; every other viewer gets their own view on top of it. */
export async function getCustomStoryState(
	chatId: string,
	storySlug: string,
	viewerId: string,
): Promise<StoryStateSnapshot> {
	const story = await requireCustomStory(chatId, storySlug);
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	const isOwner = ownerId === viewerId;
	const [shared, own, ownerName] = await Promise.all([
		storyAppStateQueries.listProjectStoryAppState(story.id),
		isOwner ? [] : storyAppStateQueries.listUserStoryAppState(story.id, viewerId),
		ownerId ? userQueries.getUserName(ownerId) : null,
	]);
	return { shared: toValues(shared), own: toValues(own), isOwner, ownerName };
}

/** With no viewer, e.g. in a delivered PDF, a story renders with the shared view its owner saved. */
export async function getSharedCustomStoryState(chatId: string, storySlug: string): Promise<StoryStateValues> {
	const story = await requireCustomStory(chatId, storySlug);
	return toValues(await storyAppStateQueries.listProjectStoryAppState(story.id));
}

/** The owner's changes update the shared view; any other viewer's change only updates their own view. */
export async function setCustomStoryState(
	chatId: string,
	storySlug: string,
	viewerId: string,
	change: StoryStateChange,
): Promise<void> {
	const story = await requireCustomStory(chatId, storySlug);
	assertValidKey(change.key);

	const isOwner = (await chatQueries.getChatOwnerId(chatId)) === viewerId;
	const stateKey = {
		storyId: story.id,
		scope: isOwner ? ('project' as const) : ('user' as const),
		userId: isOwner ? null : viewerId,
		key: change.key,
	};
	if (change.value === null || change.value === undefined) {
		await storyAppStateQueries.deleteStoryAppState(stateKey);
		return;
	}
	assertValueSize(change.key, change.value);
	await assertRoomForKey(stateKey);
	await storyAppStateQueries.upsertStoryAppState(stateKey, change.value, viewerId);
}

async function requireCustomStory(chatId: string, storySlug: string): Promise<DBStory> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	return story;
}

function toValues(rows: DBStoryAppState[]): StoryStateValues {
	return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function assertValidKey(key: string): void {
	if (!STORY_STATE_KEY_PATTERN.test(key)) {
		throw new InvalidStoryStateError(
			`"${key}" is not a valid state key: use up to 100 letters, digits, dots, colons, dashes or underscores.`,
		);
	}
}

function assertValueSize(key: string, value: unknown): void {
	const bytes = Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
	if (bytes > MAX_STORY_STATE_VALUE_BYTES) {
		throw new InvalidStoryStateError(
			`State "${key}" is ${bytes} bytes; a value may not exceed ${MAX_STORY_STATE_VALUE_BYTES} bytes.`,
		);
	}
}

async function assertRoomForKey(stateKey: storyAppStateQueries.StoryAppStateKey): Promise<void> {
	if (await storyAppStateQueries.hasStoryAppStateKey(stateKey)) {
		return;
	}
	const used = await storyAppStateQueries.countStoryAppStateKeys(stateKey.storyId, stateKey.scope, stateKey.userId);
	if (used >= MAX_STORY_STATE_KEYS) {
		throw new InvalidStoryStateError(`A story keeps at most ${MAX_STORY_STATE_KEYS} ${stateKey.scope} state keys.`);
	}
}
