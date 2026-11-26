import { useCallback } from 'react';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanelActions } from '@/contexts/side-panel';

/** Opens a story of the user, from any of their chats, beside the conversation. */
export function useOpenStoryInSidePanel() {
	const { open } = useSidePanelActions();
	return useCallback(
		(story: { chatId: string; slug: string }) => {
			open(<StoryViewer chatId={story.chatId} storySlug={story.slug} />, story.slug);
		},
		[open],
	);
}
