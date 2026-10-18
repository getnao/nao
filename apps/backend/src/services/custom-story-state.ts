import {
	MAX_STORY_STATE_KEYS,
	MAX_STORY_STATE_VALUE_BYTES,
	STORY_STATE_KEY_PATTERN,
	type StoryStateChange,
	type StoryStateSnapshot,
	type StoryStateValues,
} from '@nao/shared/story-app';

import type { DBStory, DBStoryAppState } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyAppStateQueries from '../queries/story-app-state.queries';
import { CustomStoryNotFoundError } from './custom-story';

export class InvalidStoryStateError extends Error {}

export async function getCustomStoryState(
	chatId: string,
	storySlug: string,
	viewerId: string,
): Promise<StoryStateSnapshot> {
	const story = await requireCustomStory(chatId, storySlug);
	const [shared, own] = await Promise.all([
		storyAppStateQueries.listProjectStoryAppState(story.id),
		storyAppStateQueries.listUserStoryAppState(story.id, viewerId),
	]);
	return { shared: toValues(shared), own: toValues(own) };
}

/** With no viewer, e.g. in a delivered PDF, a story renders with its shared state only. */
export async function getUnattendedCustomStoryState(chatId: string, storySlug: string): Promise<StoryStateSnapshot> {
	const story = await requireCustomStory(chatId, storySlug);
	return { shared: toValues(await storyAppStateQueries.listProjectStoryAppState(story.id)), own: {} };
}

/** A shared change is seen by every viewer of the story; any other change only by the viewer who made it. */
export async function setCustomStoryState(
	chatId: string,
	storySlug: string,
	viewerId: string,
	change: StoryStateChange,
): Promise<void> {
	const story = await requireCustomStory(chatId, storySlug);
	assertValidKey(change.key);

	const stateKey: storyAppStateQueries.StoryAppStateKey = {
		storyId: story.id,
		scope: change.shared ? 'project' : 'user',
		userId: change.shared ? null : viewerId,
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
		const kind = stateKey.scope === 'project' ? 'shared' : 'personal';
		throw new InvalidStoryStateError(`A story keeps at most ${MAX_STORY_STATE_KEYS} ${kind} state keys.`);
	}
}
