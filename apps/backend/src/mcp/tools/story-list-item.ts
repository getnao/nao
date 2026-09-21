import { z } from 'zod';

import type { UserStoryRow } from '../../queries/story.queries';

export const STORY_LIST_ITEM_SCHEMA = z.object({
	id: z.string().describe('Story UUID.'),
	title: z.string().describe('Story title.'),
	url: z.url().describe('URL to open the story in the nao UI.'),
	chatUrl: z.url().nullable().describe('Source chat URL, or null for standalone stories.'),
	archived: z.boolean().describe('True if soft-deleted via `archive_story` (still recoverable).'),
	createdAt: z.string().describe('ISO timestamp of creation.'),
	updatedAt: z.string().describe('ISO timestamp of last edit.'),
});

export type StoryListItem = z.infer<typeof STORY_LIST_ITEM_SCHEMA>;

export function toStoryListItem(story: UserStoryRow, urls: { url: string; chatUrl: string | null }): StoryListItem {
	return {
		id: story.id,
		title: story.title,
		url: urls.url,
		chatUrl: urls.chatUrl,
		archived: story.archivedAt !== null,
		createdAt: story.createdAt.toISOString(),
		updatedAt: story.updatedAt.toISOString(),
	};
}
