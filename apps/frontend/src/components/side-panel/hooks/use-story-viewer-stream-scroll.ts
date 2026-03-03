import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { StoryViewMode } from '../story-viewer.types';

interface UseStoryViewerStreamScrollParams {
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	isStreaming: boolean;
	code?: string;
	viewMode: StoryViewMode;
}

export const useStoryViewerStreamScroll = ({
	scrollContainerRef,
	isStreaming,
	code,
	viewMode,
}: UseStoryViewerStreamScrollParams) => {
	useEffect(() => {
		if (!isStreaming) {
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
			container.scrollTop = container.scrollHeight;
		});

		return () => cancelAnimationFrame(animationFrameId);
	}, [scrollContainerRef, isStreaming, code, viewMode]);
};
