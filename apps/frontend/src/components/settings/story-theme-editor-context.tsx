import { useQueryClient } from '@tanstack/react-query';
import { Moon, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { StoryThemeMode, StoryThemePair } from '@nao/shared/story-theme';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { IconSegmentedToggleOption } from '@/components/ui/icon-segmented-toggle';
import { useIsDarkMode } from '@/contexts/theme.provider';
import { trpc } from '@/main';

export const STORY_THEME_MODE_OPTIONS: readonly IconSegmentedToggleOption<StoryThemeMode>[] = [
	{ value: 'light', label: 'Light theme', icon: Sun },
	{ value: 'dark', label: 'Dark theme', icon: Moon },
];

interface StoryThemeEditorState {
	theme: StoryThemePair | null;
	setTheme: Dispatch<SetStateAction<StoryThemePair | null>>;
	mode: StoryThemeMode;
	setMode: Dispatch<SetStateAction<StoryThemeMode>>;
	viewingVersionIndex: number | null;
	setViewingVersionIndex: Dispatch<SetStateAction<number | null>>;
}

const StoryThemeEditorContext = createContext<StoryThemeEditorState | null>(null);

export function StoryThemeEditorProvider({ children }: { children: ReactNode }) {
	const isDarkMode = useIsDarkMode();
	const [theme, setThemeState] = useState<StoryThemePair | null>(null);
	const [mode, setMode] = useState<StoryThemeMode>(isDarkMode ? 'dark' : 'light');
	const [viewingVersionIndex, setViewingVersionIndex] = useState<number | null>(null);
	const setTheme = useCallback<Dispatch<SetStateAction<StoryThemePair | null>>>((action) => {
		setViewingVersionIndex(null);
		setThemeState(action);
	}, []);
	const value = useMemo(
		() => ({ theme, setTheme, mode, setMode, viewingVersionIndex, setViewingVersionIndex }),
		[theme, setTheme, mode, viewingVersionIndex],
	);
	return <StoryThemeEditorContext.Provider value={value}>{children}</StoryThemeEditorContext.Provider>;
}

export function useStoryThemeEditor(): StoryThemeEditorState {
	const context = useContext(StoryThemeEditorContext);
	if (!context) {
		throw new Error('useStoryThemeEditor must be used within StoryThemeEditorProvider');
	}
	return context;
}

export function useInvalidateStoryTheme(): () => Promise<void> {
	const queryClient = useQueryClient();
	return useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.storyTheme.getState.queryKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.storyTheme.getActive.queryKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.storyTheme.listVersions.queryKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.story.getCustomVersion.queryKey() }),
			]).then(() => undefined),
		[queryClient],
	);
}
