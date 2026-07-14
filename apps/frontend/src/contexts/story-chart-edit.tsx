import { createContext, useCallback, useContext, useMemo } from 'react';
import { buildStoryChartBlock } from '@nao/shared';
import { useStoryBlockEdit } from './use-story-block-edit';
import type { displayChart } from '@nao/shared/tools';

export interface StoryChartEditHandlers {
	/**
	 * Persists a new chart config by replacing `rawTag` (the original `<chart ... />` tag)
	 * in the story's markdown and saving a new version.
	 * Returns a promise that rejects if the save fails.
	 */
	saveChart: (rawTag: string, config: displayChart.Input) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
}

const StoryChartEditContext = createContext<StoryChartEditHandlers | null>(null);

export const useStoryChartEdit = () => useContext(StoryChartEditContext);

interface StoryChartEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

/**
 * Provides a `saveChart` handler that chart embeds inside a story can call to persist
 * edits (title/type/series/etc) back to the story via `story.createVersion`.
 */
export function StoryChartEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryChartEditProviderProps) {
	const { replaceBlock, isSaving } = useStoryBlockEdit({ chatId, storySlug, storyTitle, storyCode });

	const saveChart = useCallback(
		(rawTag: string, config: displayChart.Input) => replaceBlock(rawTag, buildStoryChartBlock(config)),
		[replaceBlock],
	);

	const value = useMemo<StoryChartEditHandlers>(() => ({ saveChart, isSaving }), [saveChart, isSaving]);

	return <StoryChartEditContext.Provider value={value}>{children}</StoryChartEditContext.Provider>;
}
