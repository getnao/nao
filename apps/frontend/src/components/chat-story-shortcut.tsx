import { useCallback } from 'react';

import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

export function ChatStoryShortcut({ chatId, latestStorySlug }: { chatId: string; latestStorySlug?: string }) {
	const sidePanel = useSidePanel();
	const handleToggleStoryPanel = useCallback(() => {
		if (sidePanel.isVisible) {
			sidePanel.close();
			return;
		}
		if (!latestStorySlug) {
			return;
		}
		sidePanel.open(<StoryViewer chatId={chatId} storySlug={latestStorySlug} />, latestStorySlug);
	}, [chatId, latestStorySlug, sidePanel]);

	useKeyboardShortcuts({
		'toggle-story-chat': sidePanel.isVisible || latestStorySlug ? handleToggleStoryPanel : undefined,
	});

	return null;
}
