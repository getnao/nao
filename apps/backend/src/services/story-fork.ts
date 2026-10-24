import { extractQueryIds } from '@nao/shared/story-segments';
import type { StoryFormat } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import type { StoryFileInput } from '../queries/story-file.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { buildQueryDataMessages, pinStoryMessageToChat, type StoryQueryDataMap } from '../utils/chat-message-story';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';
import { publishCustomStoryDraft } from './custom-story-authoring';

export interface ForkableStory {
	storyId: string;
	chatId: string | null;
	slug: string;
	title: string;
	format: StoryFormat;
	code: string;
	authorName: string | null;
}

interface ForkOwner {
	userId: string;
	projectId: string;
}

/** Copies the latest version of a story into a new chat of the owner, seeded with the data of its queries. */
export async function forkStoryIntoChat(story: ForkableStory, owner: ForkOwner): Promise<{ chatId: string }> {
	const files = story.format === 'custom' ? await listLatestFiles(story.storyId) : [];
	const queryIds = story.format === 'custom' ? extractCustomStoryQueryIds(files) : extractQueryIds(story.code);
	const queryData = await loadQueryData(story, queryIds);

	const chat = await chatQueries.createForkedChat(
		{
			projectId: owner.projectId,
			userId: owner.userId,
			title: story.title,
			forkMetadata: { type: 'story', id: story.storyId, title: story.title, authorName: story.authorName ?? '' },
		},
		buildQueryDataMessages(queryData),
	);

	try {
		await copyStory(story, files, chat.id, owner);
	} catch (error) {
		await chatQueries.deleteChat(chat.id);
		throw error;
	}
	return { chatId: chat.id };
}

function copyStory(story: ForkableStory, files: StoryFileInput[], chatId: string, owner: ForkOwner): Promise<void> {
	return story.format === 'custom'
		? copyCustomStory(story, files, chatId, owner)
		: copyClassicStory(story, chatId, owner);
}

async function listLatestFiles(storyId: string): Promise<StoryFileInput[]> {
	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	const files = version ? await storyFileQueries.listVersionFiles(version.id) : [];
	return files.map(({ path, content }) => ({ path, content }));
}

/** A standalone story has no conversation, so the data of its queries comes from its cache. */
async function loadQueryData(story: ForkableStory, queryIds: Set<string>): Promise<StoryQueryDataMap | null> {
	if (queryIds.size === 0) {
		return null;
	}
	const queryData = story.chatId
		? await executeSqlQueries.getLatestSqlQueryDataByIds(story.chatId, queryIds)
		: await loadCachedQueryData(story.storyId, queryIds);
	return Object.keys(queryData).length > 0 ? queryData : null;
}

async function loadCachedQueryData(storyId: string, queryIds: Set<string>): Promise<StoryQueryDataMap> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	const cachedQueryData = (cache?.queryData ?? {}) as StoryQueryDataMap;
	return Object.fromEntries(Object.entries(cachedQueryData).filter(([queryId]) => queryIds.has(queryId)));
}

async function copyClassicStory(story: ForkableStory, chatId: string, owner: ForkOwner): Promise<void> {
	const version = await storyQueries.createStoryVersion({
		chatId,
		slug: story.slug,
		title: story.title,
		code: story.code,
		action: 'create',
		source: 'assistant',
	});
	await pinStoryMessageToChat({
		chatId,
		slug: story.slug,
		title: story.title,
		code: story.code,
		version: version.version,
	});
	await storyFolderQueries.saveStoryInPrivateRoot(owner.userId, owner.projectId, version.storyId);
}

async function copyCustomStory(
	story: ForkableStory,
	files: StoryFileInput[],
	chatId: string,
	owner: ForkOwner,
): Promise<void> {
	const copy = await storyQueries.createCustomStory({ chatId, slug: story.slug, title: story.title });
	await storyFileQueries.seedDraftFiles(copy.id, files);
	const published = await publishCustomStoryDraft(copy, owner, 'assistant');
	if (!published.ok) {
		throw new Error(`The copy of "${story.title}" does not build.`);
	}
	await pinStoryMessageToChat({
		chatId,
		slug: story.slug,
		title: story.title,
		code: '',
		version: published.version,
		files: published.files,
	});
}
