import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { STORY_HIGHLIGHT_TTL_MS, useStoryHighlightRequest } from '@/stores/story-highlight';
import { highlightStoryElement } from '@/story-runtime/story-highlight';

export const STORY_OVERLAY_Z_INDEX = 10;

/** Outlines, within a classic story's container, the element a clicked citation points at. */
export function useCitedElementHighlight(containerRef: RefObject<HTMLElement | null>, storySlug: string | undefined) {
	const request = useStoryHighlightRequest();
	const handledRequestId = useRef<number | null>(null);
	const stopWaiting = useRef<() => void>(() => {});

	useEffect(() => {
		const container = containerRef.current;
		const isForThisStory =
			request &&
			(!request.storySlug || !storySlug || request.storySlug === storySlug) &&
			Date.now() - request.requestedAt < STORY_HIGHLIGHT_TTL_MS;
		if (!isForThisStory || !container || handledRequestId.current === request.id) {
			return;
		}
		handledRequestId.current = request.id;
		stopWaiting.current();
		stopWaiting.current = highlightStoryElement(request.element, {
			root: container,
			zIndex: STORY_OVERLAY_Z_INDEX,
		});
	}, [containerRef, request, storySlug]);
}
