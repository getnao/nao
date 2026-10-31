import type { StoryFormat } from '@nao/shared/types';

import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { buildQueryDataMessages, pinStoryMessageToChat } from '../utils/chat-message-story';

export interface StandaloneStory {
	id: string;
	slug: string;
	title: string;
	code: string;
	format: StoryFormat;
}

interface StoryOwner {
	userId: string;
	projectId: string;
}

/**
 * Gives a story created outside any chat a chat of its own, seeded with its cached query data, so it can be
 * edited there like any other story.
 */
export async function attachChatToStandaloneStory(
	story: StandaloneStory,
	owner: StoryOwner,
): Promise<{ chatId: string }> {
	const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
	const seedMessages = cache?.queryData
		? buildQueryDataMessages(cache.queryData as Record<string, { data: unknown[]; columns: string[] }>)
		: [];

	const chat = await chatQueries.createForkedChat(
		{ projectId: owner.projectId, userId: owner.userId, title: story.title },
		seedMessages,
	);

	const latestVersion = await storyQueries.getLatestVersionByStoryId(story.id);
	await storyQueries.assignChatToStory(story.id, chat.id);
	await pinStoryMessageToChat({
		chatId: chat.id,
		slug: story.slug,
		title: story.title,
		code: story.format === 'custom' ? '' : story.code,
		version: latestVersion?.version ?? 1,
		...(story.format === 'custom' && { files: await listVersionFilePaths(latestVersion?.id) }),
	});

	return { chatId: chat.id };
}

async function listVersionFilePaths(versionId: string | undefined): Promise<string[]> {
	const files = versionId ? await storyFileQueries.listVersionFiles(versionId) : [];
	return files.map((file) => file.path);
}
