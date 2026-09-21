import { createContext, useCallback, useContext, useMemo } from 'react';
import { buildStoryTableBlock } from '@nao/shared';
import { useStoryBlockEdit } from './use-story-block-edit';
import type { StoryTableBlockInput } from '@nao/shared';

export interface StoryTableEditHandlers {
	/**
	 * Persists new table formatting by replacing `rawTag` (the original `<table ... />`
	 * tag) in the story's markdown and saving a new version. Rejects if the save fails.
	 */
	saveTable: (rawTag: string, config: StoryTableBlockInput) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
}

const StoryTableEditContext = createContext<StoryTableEditHandlers | null>(null);

export const useStoryTableEdit = () => useContext(StoryTableEditContext);

interface StoryTableEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

/**
 * Provides a `saveTable` handler that table embeds inside a story can call to
 * persist conditional-formatting edits back to the story via `story.createVersion`.
 */
export function StoryTableEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryTableEditProviderProps) {
	const { replaceBlock, isSaving } = useStoryBlockEdit({ chatId, storySlug, storyTitle, storyCode });

	const saveTable = useCallback(
		(rawTag: string, config: StoryTableBlockInput) => replaceBlock(rawTag, buildStoryTableBlock(config)),
		[replaceBlock],
	);

	const value = useMemo<StoryTableEditHandlers>(() => ({ saveTable, isSaving }), [saveTable, isSaving]);

	return <StoryTableEditContext.Provider value={value}>{children}</StoryTableEditContext.Provider>;
}
