import type { StoryVersionChange, StoryVersionVia } from '@nao/shared/types';

import * as storyQueries from '../queries/story.queries';

export async function listStoryVersionChanges(
	story: { id: string; chatId: string | null },
	viewerId: string,
): Promise<Map<number, StoryVersionChange>> {
	const rows = await storyQueries.listStoryVersionChanges(story.id);
	return new Map(rows.map((row) => [row.version, describeChange(row, story.chatId, viewerId)]));
}

function describeChange(
	row: storyQueries.StoryVersionChangeRow,
	storyChatId: string | null,
	viewerId: string,
): StoryVersionChange {
	return {
		author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName } : null,
		via: describeVia(row, storyChatId),
		chat: visibleSourceChat(row, viewerId),
	};
}

function describeVia(row: storyQueries.StoryVersionChangeRow, storyChatId: string | null): StoryVersionVia {
	if (row.origin === null) {
		return row.source === 'assistant' ? 'agent' : 'editor';
	}
	if (row.origin !== 'agent') {
		return row.origin;
	}
	if (!row.sourceChat) {
		return 'agent';
	}
	if (row.sourceChat.id === storyChatId) {
		return 'original_chat';
	}
	return row.sourceChat.isQuickQuestion ? 'quick_question' : 'chat';
}

function visibleSourceChat(row: storyQueries.StoryVersionChangeRow, viewerId: string): StoryVersionChange['chat'] {
	const { sourceChat } = row;
	if (!sourceChat || sourceChat.ownerId !== viewerId || sourceChat.isDeleted) {
		return null;
	}
	return { id: sourceChat.id, title: sourceChat.title };
}
