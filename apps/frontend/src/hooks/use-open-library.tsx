import { useCallback } from 'react';
import { LibraryPanel } from '@/components/library/library-panel';
import { useSidePanel } from '@/contexts/side-panel';
import { libraryLastItemStore } from '@/stores/library';

/** Opens the library side panel on the given item, or on wherever the user last left it in this chat. */
export function useOpenLibrary(chatId: string) {
	const { open } = useSidePanel();

	return useCallback(
		(itemId?: string | null) => {
			if (itemId !== undefined) {
				libraryLastItemStore.set(chatId, itemId);
			}
			open(<LibraryPanel chatId={chatId} />);
		},
		[chatId, open],
	);
}
