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
	saveChart: (rawTag: string, config: displayChart.ChartInput) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
	/** Human-readable hint describing how the edit is persisted, shown in the edit dialog. */
	saveDescription: string;
}

const VERSION_SAVE_DESCRIPTION = 'Tweak the chart parameters. Changes are saved to the story as a new version.';
const EDITOR_SAVE_DESCRIPTION =
	'Tweak the chart parameters. Changes apply to the story you are editing and are saved when you save the story.';

const StoryChartEditContext = createContext<StoryChartEditHandlers | null>(null);

export const useStoryChartEdit = () => useContext(StoryChartEditContext);

interface EditorStoryChartEditProviderProps {
	/**
	 * Applies an edited chart tag to the live editor buffer, given the chart's
	 * original `<chart ... />` tag and its replacement.
	 */
	onReplaceTag: (rawTag: string, nextTag: string) => void;
	children: React.ReactNode;
}

export function EditorStoryChartEditProvider({ onReplaceTag, children }: EditorStoryChartEditProviderProps) {
	const value = useMemo<StoryChartEditHandlers>(
		() => ({
			saveChart: async (rawTag, config) => {
				onReplaceTag(rawTag, buildStoryChartBlock(config));
			},
			isSaving: false,
			saveDescription: EDITOR_SAVE_DESCRIPTION,
		}),
		[onReplaceTag],
	);

	return <StoryChartEditContext.Provider value={value}>{children}</StoryChartEditContext.Provider>;
}

interface StoryChartEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

export function StoryChartEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryChartEditProviderProps) {
	const { replaceBlock, isSaving } = useStoryBlockEdit({ chatId, storySlug, storyTitle, storyCode });

	const saveChart = useCallback(
		(rawTag: string, config: displayChart.ChartInput) => replaceBlock(rawTag, buildStoryChartBlock(config)),
		[replaceBlock],
	);

	const value = useMemo<StoryChartEditHandlers>(
		() => ({ saveChart, isSaving, saveDescription: VERSION_SAVE_DESCRIPTION }),
		[saveChart, isSaving],
	);

	return <StoryChartEditContext.Provider value={value}>{children}</StoryChartEditContext.Provider>;
}
