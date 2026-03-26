import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StoryDraft } from '@/lib/story.utils';
import type { QueryDataMap } from '@/components/story-embeds';
import { trpc } from '@/main';

interface UseStoryViewerContentParams {
	storyId: string;
	resolvedStoryId: string;
	chatId: string;
	draftStory: StoryDraft | null;
	currentVersion: { code: string } | undefined;
	storedTitle: string | undefined;
}

export const useStoryViewerContent = ({
	storyId,
	resolvedStoryId,
	chatId,
	draftStory,
	currentVersion,
	storedTitle,
}: UseStoryViewerContentParams) => {
	const shouldUseDraftStory = Boolean(draftStory && (draftStory.isStreaming || !currentVersion));

	const storyTitle = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.title ?? storedTitle ?? storyId)
				: (storedTitle ?? draftStory?.title ?? storyId),
		[shouldUseDraftStory, draftStory?.title, storedTitle, storyId],
	);

	const storyCode = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.code ?? currentVersion?.code)
				: (currentVersion?.code ?? draftStory?.code),
		[shouldUseDraftStory, draftStory?.code, currentVersion?.code],
	);

	const latestStoryQuery = useQuery(trpc.story.getLatest.queryOptions({ chatId, storyId: resolvedStoryId }));
	const queryData = latestStoryQuery.data?.queryData as QueryDataMap | null | undefined;
	const cachedAt = latestStoryQuery.data?.cachedAt as string | null | undefined;

	return { storyTitle, storyCode, queryData, cachedAt };
};
