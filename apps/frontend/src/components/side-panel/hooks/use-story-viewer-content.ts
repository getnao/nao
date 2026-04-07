import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StoryDraft } from '@/lib/story.utils';
import type { QueryDataMap } from '@/components/story-embeds';
import { trpc } from '@/main';

interface UseStoryViewerContentParams {
	storySlug: string;
	resolvedStorySlug: string;
	chatId: string;
	draftStory: StoryDraft | null;
	currentVersion: { code: string } | undefined;
	storedTitle: string | undefined;
	isReadonlyMode?: boolean;
}

export const useStoryViewerContent = ({
	storySlug,
	resolvedStorySlug,
	chatId,
	draftStory,
	currentVersion,
	storedTitle,
	isReadonlyMode,
}: UseStoryViewerContentParams) => {
	const shouldUseDraftStory = Boolean(draftStory && (draftStory.isStreaming || !currentVersion));

	const storyTitle = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.title ?? storedTitle ?? storySlug)
				: (storedTitle ?? draftStory?.title ?? storySlug),
		[shouldUseDraftStory, draftStory?.title, storedTitle, storySlug],
	);

	const storyCode = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.code ?? currentVersion?.code)
				: (currentVersion?.code ?? draftStory?.code),
		[shouldUseDraftStory, draftStory?.code, currentVersion?.code],
	);

	const latestStoryQuery = useQuery({
		...trpc.story.getLatest.queryOptions({ chatId, storySlug: resolvedStorySlug }),
		enabled: !isReadonlyMode,
	});
	const queryData = latestStoryQuery.data?.queryData as QueryDataMap | null | undefined;
	const cachedAt = latestStoryQuery.data?.cachedAt as string | null | undefined;

	return { storyTitle, storyCode, queryData, cachedAt };
};
