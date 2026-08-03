import { useEffect, useMemo, useRef, useState } from 'react';
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
	const [isBridgingDraft, setIsBridgingDraft] = useState(false);
	const wasStoryStreamingRef = useRef(Boolean(draftStory?.isStreaming));
	const viewedStorySlugRef = useRef(storySlug);

	if (viewedStorySlugRef.current !== storySlug) {
		viewedStorySlugRef.current = storySlug;
		wasStoryStreamingRef.current = Boolean(draftStory?.isStreaming);
		if (isBridgingDraft) {
			setIsBridgingDraft(false);
		}
	}

	useEffect(() => {
		const isStoryStreaming = Boolean(draftStory?.isStreaming);
		if (wasStoryStreamingRef.current && !isStoryStreaming) {
			setIsBridgingDraft(true);
		}
		wasStoryStreamingRef.current = isStoryStreaming;
	}, [draftStory?.isStreaming]);

	useEffect(() => {
		if (!isBridgingDraft) {
			return;
		}
		const committedCaughtUp = Boolean(currentVersion && draftStory && currentVersion.code === draftStory.code);
		if (!draftStory || committedCaughtUp) {
			setIsBridgingDraft(false);
		}
	}, [isBridgingDraft, draftStory, currentVersion]);

	const shouldUseDraftStory = Boolean(draftStory && (draftStory.isStreaming || isBridgingDraft || !currentVersion));

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
	const lastRefreshFailure = latestStoryQuery.data?.lastRefreshFailure;

	return { storyTitle, storyCode, queryData, cachedAt, lastRefreshFailure, isLoading: latestStoryQuery.isLoading };
};
