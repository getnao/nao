import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { extractStoryReferenceIds, toStoryReferenceMentionId } from '@nao/shared';
import type { MentionOption } from 'prompt-mentions';
import type {
	DatabaseObject,
	ReferenceableStory,
	ReferenceMentionMenu,
	StoryFolder,
	StoryFolderItem,
} from '@/lib/reference-mention-menu';
import { useChatId } from '@/hooks/use-chat-id';
import { buildReferenceMentionMenu, QUICK_PICK_COUNT, toStoryReferenceOption } from '@/lib/reference-mention-menu';
import { trpc } from '@/main';

const NO_STORIES: ReferenceableStory[] = [];
const NO_FOLDERS: StoryFolder[] = [];
const NO_FOLDER_ITEMS: StoryFolderItem[] = [];
const NO_DATABASE_OBJECTS: DatabaseObject[] = [];

type ReferenceFilter = { excludeCurrentChat?: boolean };

/** The stories, story folders, tables and schemas the user can mention with @. */
export function useReferenceMentionMenu(filter: ReferenceFilter = {}): ReferenceMentionMenu {
	const { stories } = useReferenceableStories(filter);
	const mostViewedStories = useMostViewedStories(filter);
	const { data: folders = NO_FOLDERS } = useQuery(trpc.storyFolder.listTree.queryOptions({ archived: false }));
	const { data: folderItems = NO_FOLDER_ITEMS } = useQuery(trpc.storyFolder.listItems.queryOptions());
	const { data: databaseObjects = NO_DATABASE_OBJECTS } = useQuery(trpc.project.getDatabaseObjects.queryOptions());
	return useMemo(
		() => buildReferenceMentionMenu({ stories, mostViewedStories, folders, folderItems, databaseObjects }),
		[stories, mostViewedStories, folders, folderItems, databaseObjects],
	);
}

/** Pinned and certified first. */
export function useReferenceableStories(filter: ReferenceFilter = {}): {
	stories: ReferenceableStory[];
	isLoaded: boolean;
} {
	const { data: allStories = NO_STORIES, isSuccess } = useQuery(trpc.story.listReferenceable.queryOptions());
	return { stories: useFilteredStories(allStories, filter), isLoaded: isSuccess };
}

/** The referenceable list stops at its most trusted and recent stories, so older mentioned stories are resolved one by one. */
export function useMentionedStoryOptions(text: string, knownOptions: MentionOption[]): MentionOption[] {
	const missingStoryIds = useMemo(() => {
		const knownIds = new Set(knownOptions.map((option) => option.id));
		return extractStoryReferenceIds(text).filter((storyId) => !knownIds.has(toStoryReferenceMentionId(storyId)));
	}, [text, knownOptions]);
	return useQueries({
		queries: missingStoryIds.map((storyId) => ({ ...trpc.story.resolve.queryOptions({ storyId }), retry: false })),
		combine: toResolvedStoryOptions,
	});
}

function useMostViewedStories(filter: ReferenceFilter): ReferenceableStory[] {
	const { data: mostViewedStories = NO_STORIES } = useQuery(
		trpc.story.listMostViewed.queryOptions({ limit: QUICK_PICK_COUNT }),
	);
	return useFilteredStories(mostViewedStories, filter);
}

function useFilteredStories(
	stories: ReferenceableStory[],
	{ excludeCurrentChat = false }: ReferenceFilter,
): ReferenceableStory[] {
	const chatId = useChatId();
	return useMemo(
		() => stories.filter((story) => !excludeCurrentChat || !chatId || story.chatId !== chatId),
		[stories, chatId, excludeCurrentChat],
	);
}

function toResolvedStoryOptions(results: { data?: { storyId: string; title: string } }[]): MentionOption[] {
	return results.flatMap(({ data }) => (data ? [toStoryReferenceOption(data)] : []));
}
