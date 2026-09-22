import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { trpc } from '@/main';

interface StoryThemeEditorState {
	theme: StoryTheme | null;
	setTheme: Dispatch<SetStateAction<StoryTheme | null>>;
	viewingVersionIndex: number | null;
	setViewingVersionIndex: Dispatch<SetStateAction<number | null>>;
}

const StoryThemeEditorContext = createContext<StoryThemeEditorState | null>(null);

export function StoryThemeEditorProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<StoryTheme | null>(null);
	const [viewingVersionIndex, setViewingVersionIndex] = useState<number | null>(null);
	const setTheme = useCallback<Dispatch<SetStateAction<StoryTheme | null>>>((action) => {
		setViewingVersionIndex(null);
		setThemeState(action);
	}, []);
	const value = useMemo(
		() => ({ theme, setTheme, viewingVersionIndex, setViewingVersionIndex }),
		[theme, setTheme, viewingVersionIndex],
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
