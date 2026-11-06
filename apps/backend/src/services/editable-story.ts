import type { DBStory } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { ToolContext } from '../types/tools';
import { attachChatToStandaloneStory } from './standalone-story';

export type EditableStoryScope = Pick<ToolContext, 'chatId' | 'linkedStory' | 'userId' | 'projectId'>;

/** A story of this chat, or of any other chat when the user can edit it. */
export async function findEditableStory(
	scope: EditableStoryScope,
	storyId: string,
): Promise<{ story: DBStory } | { error: string }> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		return notFoundError(storyId);
	}
	if (scope.chatId && story.chatId === scope.chatId) {
		return { story };
	}
	const referenceable = await storyReferenceQueries.getReferenceableStory(scope.userId, scope.projectId, storyId);
	if (!referenceable) {
		return notFoundError(storyId);
	}
	return referenceable.canEdit ? { story } : readOnlyError(storyId);
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

function readOnlyError(storyId: string): { error: string } {
	return { error: `Story "${storyId}" is read-only here: only its owner can edit it.` };
}

function notFoundError(storyId: string): { error: string } {
	return {
		error: `No story with the id "${storyId}". Stories are addressed by their id, given in the conversation artifacts; "create" starts a new one.`,
	};
}
