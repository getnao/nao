import type { DBStory } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ToolContext } from '../types/tools';
import { attachChatToStandaloneStory } from './standalone-story';

export type EditableStoryScope = Pick<ToolContext, 'chatId' | 'linkedStory' | 'userId' | 'projectId'>;

/**
 * The story an agent addresses from a chat: the slug of the story a quick question is about, the slug of a story of
 * this chat, or the id of any story the user can edit. Slugs win as they are what the chat knows its stories by.
 */
export async function findEditableStory(
	scope: EditableStoryScope,
	slugOrId: string,
): Promise<{ story: DBStory } | { error: string }> {
	const { linkedStory } = scope;
	if (linkedStory?.slug === slugOrId) {
		if (!linkedStory.canEdit) {
			return readOnlyError(slugOrId);
		}
		const story = await storyQueries.getStoryById(linkedStory.storyId);
		if (story) {
			return { story };
		}
	}
	const ownStory = await storyQueries.getStoryByChatAndSlug(scope.chatId, slugOrId);
	return ownStory ? { story: ownStory } : findEditableStoryById(scope, slugOrId);
}

/** The chat holding the story's versions: a standalone story gets one the first time an edit goes through. */
export async function ensureStoryChat(story: DBStory, scope: EditableStoryScope): Promise<string> {
	if (story.chatId) {
		return story.chatId;
	}
	const latest = await storyQueries.getLatestVersionByStoryId(story.id);
	const { chatId } = await attachChatToStandaloneStory(
		{ id: story.id, slug: story.slug, title: story.title, code: latest?.code ?? '', format: story.format },
		{ userId: scope.userId, projectId: scope.projectId },
	);
	return chatId;
}

async function findEditableStoryById(
	scope: EditableStoryScope,
	storyId: string,
): Promise<{ story: DBStory } | { error: string }> {
	const referenceable = await storyReferenceQueries.getReferenceableStory(scope.userId, scope.projectId, storyId);
	if (!referenceable) {
		return notFoundError(storyId);
	}
	if (!referenceable.canEdit) {
		return readOnlyError(storyId);
	}
	const story = await storyQueries.getStoryById(storyId);
	return story ? { story } : notFoundError(storyId);
}

function readOnlyError(slugOrId: string): { error: string } {
	return { error: `Story "${slugOrId}" is read-only here: only its owner can edit it.` };
}

function notFoundError(slugOrId: string): { error: string } {
	return { error: `Story "${slugOrId}" does not exist. Create it first with the story tool.` };
}
