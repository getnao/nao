import { useCallback } from 'react';
import { useSidePanel } from '@/contexts/side-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useOpenLibrary } from '@/hooks/use-open-library';

export function LibraryShortcut({ chatId }: { chatId: string }) {
	const sidePanel = useSidePanel();
	const openLibrary = useOpenLibrary(chatId);
	const toggleLibrary = useCallback(() => {
		if (sidePanel.isVisible) {
			sidePanel.close();
			return;
		}
		openLibrary();
	}, [openLibrary, sidePanel]);

	useKeyboardShortcuts({ 'toggle-story-chat': toggleLibrary });

	return null;
}
