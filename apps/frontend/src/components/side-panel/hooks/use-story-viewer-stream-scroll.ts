import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { StoryViewMode } from '../story-viewer.types';

const STREAM_SCROLL_BOTTOM_THRESHOLD = 64;

interface UseStoryViewerStreamScrollParams {
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	isAppendingContent: boolean;
	code?: string;
	viewMode: StoryViewMode;
}

export const useStoryViewerStreamScroll = ({
	scrollContainerRef,
	isAppendingContent,
	code,
	viewMode,
}: UseStoryViewerStreamScrollParams) => {
	const isNearBottomRef = useRef(true);
	const hasContent = Boolean(code);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!container) {
			return;
		}

		const handleScroll = () => {
			isNearBottomRef.current = isContainerNearBottom(container);
		};

		container.addEventListener('scroll', handleScroll);

		return () => container.removeEventListener('scroll', handleScroll);
	}, [scrollContainerRef, hasContent]);

	useEffect(() => {
		if (!isAppendingContent || !isNearBottomRef.current) {
			return;
		}

		if (viewMode !== 'preview' && viewMode !== 'code') {
			return;
		}

		const container = scrollContainerRef.current;
		if (!container) {
			return;
		}

		const animationFrameId = requestAnimationFrame(() => {
			if (isNearBottomRef.current) {
				container.scrollTop = container.scrollHeight;
			}
		});

		return () => cancelAnimationFrame(animationFrameId);
	}, [scrollContainerRef, isAppendingContent, code, viewMode]);
};

const isContainerNearBottom = (container: HTMLDivElement) => {
	if (container.scrollHeight <= container.clientHeight) {
		return true;
	}

	return container.scrollHeight - container.scrollTop - container.clientHeight <= STREAM_SCROLL_BOTTOM_THRESHOLD;
};
