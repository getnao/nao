import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryDraft } from '@/lib/story.utils';
import { useThrottledValue } from '@/hooks/use-throttled-value';
import { trpc } from '@/main';

const STORY_STREAM_THROTTLE_INTERVAL_MS = 120;

interface UseStoryViewerContentParams {
	storySlug: string;
	resolvedStorySlug: string;
	chatId: string;
	draftStory: StoryDraft | null;
	currentVersion: { code: string } | undefined;
	storedTitle: string | undefined;
	isViewingLatest: boolean;
	isStoryInterrupted: boolean;
	isReadonlyMode?: boolean;
}

export const useStoryViewerContent = ({
	storySlug,
	resolvedStorySlug,
	chatId,
	draftStory,
	currentVersion,
	storedTitle,
	isViewingLatest,
	isStoryInterrupted,
	isReadonlyMode,
}: UseStoryViewerContentParams) => {
	const [isBridgingDraft, setIsBridgingDraft] = useState(false);
	const isStoryStreaming = Boolean(draftStory?.isStreaming);
	const wasStoryStreamingRef = useRef(isStoryStreaming);
	const bridgeBaselineCodeRef = useRef<string | undefined>(undefined);
	const committedCodeRef = useRef(currentVersion?.code);
	const viewedStorySlugRef = useRef(storySlug);
	const throttledDraftCode = useThrottledValue(draftStory?.code, STORY_STREAM_THROTTLE_INTERVAL_MS, isStoryStreaming);

	if (viewedStorySlugRef.current !== storySlug) {
		viewedStorySlugRef.current = storySlug;
		wasStoryStreamingRef.current = isStoryStreaming;
		bridgeBaselineCodeRef.current = undefined;
		committedCodeRef.current = currentVersion?.code;
		if (isBridgingDraft) {
			setIsBridgingDraft(false);
		}
	}

	useEffect(() => {
		if (wasStoryStreamingRef.current && !isStoryStreaming) {
			if (isViewingLatest && !isStoryInterrupted) {
				bridgeBaselineCodeRef.current = committedCodeRef.current;
				setIsBridgingDraft(true);
			} else {
				bridgeBaselineCodeRef.current = undefined;
				setIsBridgingDraft(false);
			}
		}
		wasStoryStreamingRef.current = isStoryStreaming;
		committedCodeRef.current = currentVersion?.code;
	}, [isStoryStreaming, isStoryInterrupted, isViewingLatest, currentVersion?.code]);

	useEffect(() => {
		if (!isBridgingDraft) {
			return;
		}
		const committedCaughtUp = Boolean(currentVersion && draftStory && currentVersion.code === draftStory.code);
		const committedChanged = Boolean(currentVersion && currentVersion.code !== bridgeBaselineCodeRef.current);
		if (!draftStory || !isViewingLatest || isStoryInterrupted || committedCaughtUp || committedChanged) {
			bridgeBaselineCodeRef.current = undefined;
			setIsBridgingDraft(false);
		}
	}, [isBridgingDraft, draftStory, currentVersion, isStoryInterrupted, isViewingLatest]);

	const shouldUseDraftStory = Boolean(
		isViewingLatest &&
		!isStoryInterrupted &&
		draftStory &&
		(draftStory.isStreaming || isBridgingDraft || !currentVersion),
	);
	const canUseDraftFallback = isViewingLatest && !currentVersion;

	const storyTitle = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.title ?? storedTitle ?? storySlug)
				: (storedTitle ?? (canUseDraftFallback ? draftStory?.title : undefined) ?? storySlug),
		[shouldUseDraftStory, draftStory?.title, storedTitle, storySlug, canUseDraftFallback],
	);

	const storyCode = useMemo(
		() =>
			shouldUseDraftStory
				? (throttledDraftCode ?? currentVersion?.code)
				: (currentVersion?.code ?? (canUseDraftFallback ? draftStory?.code : undefined)),
		[shouldUseDraftStory, throttledDraftCode, currentVersion?.code, canUseDraftFallback, draftStory?.code],
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
