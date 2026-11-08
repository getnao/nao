import type { DBStory } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import { extractCustomStoryQueryIds } from '../utils/story-query-data';

export class CustomStoryQueryNotAllowedError extends Error {
	constructor(queryId: string) {
		super(`Query ${queryId} is not part of this story.`);
	}
}

/** Someone who does not own the chat may not reach its other queries by citing them in the story's sources. */
export async function assertWriterAddsNoChatQueries(
	story: Pick<DBStory, 'chatId' | 'slug'>,
	writerId: string,
	files: { content: string }[],
): Promise<void> {
	if (story.chatId && (await chatQueries.getChatOwnerId(story.chatId)) !== writerId) {
		await assertNoNewChatQueries(story.chatId, story.slug, files);
	}
}

/** The queries the latest published version or the draft of the story reference. */
export async function listCustomStoryQueryIds(chatId: string, storySlug: string): Promise<Set<string>> {
	const [story, latestVersion] = await Promise.all([
		storyQueries.getStoryByChatAndSlug(chatId, storySlug),
		storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug),
	]);
	const [versionFiles, draftFiles] = await Promise.all([
		latestVersion ? storyFileQueries.listVersionFiles(latestVersion.id) : [],
		story ? storyFileQueries.listDraftFiles(story.id) : [],
	]);
	return extractCustomStoryQueryIds([...versionFiles, ...draftFiles]);
}

async function assertNoNewChatQueries(chatId: string, storySlug: string, files: { content: string }[]): Promise<void> {
	const knownIds = await listCustomStoryQueryIds(chatId, storySlug);
	const addedIds = [...extractCustomStoryQueryIds(files)].filter((queryId) => !knownIds.has(queryId));
	const storedQueries = await Promise.all(addedIds.map((queryId) => storyQueries.getSqlQueryById(chatId, queryId)));
	const chatQueryIndex = storedQueries.findIndex((query) => query !== null);
	if (chatQueryIndex !== -1) {
		throw new CustomStoryQueryNotAllowedError(addedIds[chatQueryIndex]);
	}
}
