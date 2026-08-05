import { createContext, useCallback, useContext, useMemo } from 'react';
import { buildStoryMapBlock } from '@nao/shared';
import { useStoryBlockEdit } from './use-story-block-edit';
import type { displayMap } from '@nao/shared/tools';

export interface StoryMapEditHandlers {
	/**
	 * Persists a new map config by replacing `rawTag` (the original `<map ... />` tag)
	 * in the story's markdown and saving a new version. Rejects if the save fails.
	 */
	saveMap: (rawTag: string, config: displayMap.Input) => Promise<void>;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
	/** Human-readable hint describing how the edit is persisted, shown in the edit dialog. */
	saveDescription: string;
}

const VERSION_SAVE_DESCRIPTION = 'Tweak the map parameters. Changes are saved to the story as a new version.';
const EDITOR_SAVE_DESCRIPTION =
	'Tweak the map parameters. Changes apply to the story you are editing and are saved when you save the story.';

const StoryMapEditContext = createContext<StoryMapEditHandlers | null>(null);

export const useStoryMapEdit = () => useContext(StoryMapEditContext);

interface EditorStoryMapEditProviderProps {
	/**
	 * Applies an edited map tag to the live editor buffer, given the map's
	 * original `<map ... />` tag and its replacement.
	 */
	onReplaceTag: (rawTag: string, nextTag: string) => void;
	children: React.ReactNode;
}

export function EditorStoryMapEditProvider({ onReplaceTag, children }: EditorStoryMapEditProviderProps) {
	const value = useMemo<StoryMapEditHandlers>(
		() => ({
			saveMap: async (rawTag, config) => {
				onReplaceTag(rawTag, buildStoryMapBlock(config));
			},
			isSaving: false,
			saveDescription: EDITOR_SAVE_DESCRIPTION,
		}),
		[onReplaceTag],
	);

	return <StoryMapEditContext.Provider value={value}>{children}</StoryMapEditContext.Provider>;
}

interface StoryMapEditProviderProps {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	storyCode: string;
	children: React.ReactNode;
}

export function StoryMapEditProvider({
	chatId,
	storySlug,
	storyTitle,
	storyCode,
	children,
}: StoryMapEditProviderProps) {
	const { replaceBlock, isSaving } = useStoryBlockEdit({ chatId, storySlug, storyTitle, storyCode });

	const saveMap = useCallback(
		(rawTag: string, config: displayMap.Input) => replaceBlock(rawTag, buildStoryMapBlock(config)),
		[replaceBlock],
	);

	const value = useMemo<StoryMapEditHandlers>(
		() => ({ saveMap, isSaving, saveDescription: VERSION_SAVE_DESCRIPTION }),
		[saveMap, isSaving],
	);

	return <StoryMapEditContext.Provider value={value}>{children}</StoryMapEditContext.Provider>;
}
