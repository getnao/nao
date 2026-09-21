import { createContext, useContext } from 'react';
import type { DragOrigin } from '@/components/side-panel/story-block-selection';

export interface StoryTabDestination {
	index: number;
	title: string;
}

interface StoryEditorSelectionActionsValue {
	destinations: StoryTabDestination[];
	moveSelection: (origin: DragOrigin, destinationTabIndex: number) => void;
}

const StoryEditorSelectionActionsContext = createContext<StoryEditorSelectionActionsValue | null>(null);

export function StoryEditorSelectionActionsProvider({
	value,
	children,
}: {
	value: StoryEditorSelectionActionsValue;
	children: React.ReactNode;
}) {
	return (
		<StoryEditorSelectionActionsContext.Provider value={value}>
			{children}
		</StoryEditorSelectionActionsContext.Provider>
	);
}

export function useStoryEditorSelectionActions(): StoryEditorSelectionActionsValue | null {
	return useContext(StoryEditorSelectionActionsContext);
}
