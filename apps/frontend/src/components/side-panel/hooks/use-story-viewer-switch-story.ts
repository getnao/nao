import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useSidePanel } from '@/contexts/side-panel';

interface UseStoryViewerSwitchStoryParams {
	renderStoryViewer: (storyId: string) => ReactNode;
}

export const useStoryViewerSwitchStory = ({ renderStoryViewer }: UseStoryViewerSwitchStoryParams) => {
	const { open: openSidePanel } = useSidePanel();

	const switchStory = useCallback(
		(storyId: string) => {
			openSidePanel(renderStoryViewer(storyId), storyId);
		},
		[openSidePanel, renderStoryViewer],
	);

	return {
		switchStory,
	};
};
