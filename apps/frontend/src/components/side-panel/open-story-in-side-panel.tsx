import { useCallback } from 'react';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';

/** Opens a story of the user, from any of their chats, beside the conversation. */
export function useOpenStoryInSidePanel() {
	const { open } = useSidePanel();
	return useCallback(
		(story: { chatId: string; slug: string }) => {
			open(<StoryViewer chatId={story.chatId} storySlug={story.slug} />, story.slug);
		},
		[open],
	);
}
