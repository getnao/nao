import { z } from 'zod';

import type { UserStoryRow } from '../../queries/story.queries';

export const STORY_KIND_SCHEMA = z
	.enum(['own', 'shared-with-me', 'shared-project'])
	.describe(
		'Where this story came from. "own" is a story the caller created; "shared-with-me" is granted ' +
			'to the caller directly or via a user group; "shared-project" is shared with the whole project.',
	);

export const STORY_LIST_ITEM_SCHEMA = z.object({
	id: z.string().describe('Story UUID. Pass to `get_story`.'),
	title: z.string().describe('Story title.'),
	url: z.url().describe('URL to open the story in the nao UI.'),
	chatUrl: z.url().nullable().describe('Source chat URL, or null for standalone stories.'),
	archived: z.boolean().describe('True if soft-deleted via `archive_story` (still recoverable).'),
	kind: STORY_KIND_SCHEMA,
	shareId: z
		.string()
		.nullable()
		.describe(
			'Share UUID for shared stories; null for own stories. The UUID in a /stories/shared/<id> URL ' +
				'is this `shareId` — `get_story` accepts both `id` and `shareId`.',
		),
	createdAt: z.string().describe('ISO timestamp of creation.'),
	updatedAt: z.string().describe('ISO timestamp of last edit.'),
});

export type StoryKind = z.infer<typeof STORY_KIND_SCHEMA>;
export type StoryListItem = z.infer<typeof STORY_LIST_ITEM_SCHEMA>;

export function toStoryListItem(
	story: UserStoryRow,
	urls: { url: string; chatUrl: string | null },
	share?: { kind: StoryKind; shareId: string | null },
): StoryListItem {
	return {
		id: story.id,
		title: story.title,
		url: urls.url,
		chatUrl: urls.chatUrl,
		archived: story.archivedAt !== null,
		kind: share?.kind ?? 'own',
		shareId: share?.shareId ?? null,
		createdAt: story.createdAt.toISOString(),
		updatedAt: story.updatedAt.toISOString(),
	};
}
