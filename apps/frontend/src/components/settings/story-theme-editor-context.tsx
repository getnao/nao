import { createContext, useContext, useMemo, useState } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

interface StoryThemeEditorState {
	theme: StoryTheme | null;
	setTheme: Dispatch<SetStateAction<StoryTheme | null>>;
}

const StoryThemeEditorContext = createContext<StoryThemeEditorState | null>(null);

export function StoryThemeEditorProvider({ children }: { children: ReactNode }) {
	const [theme, setTheme] = useState<StoryTheme | null>(null);
	const value = useMemo(() => ({ theme, setTheme }), [theme]);
	return <StoryThemeEditorContext.Provider value={value}>{children}</StoryThemeEditorContext.Provider>;
}

export function useStoryThemeEditor(): StoryThemeEditorState {
	const context = useContext(StoryThemeEditorContext);
	if (!context) {
		throw new Error('useStoryThemeEditor must be used within StoryThemeEditorProvider');
	}
	return context;
}
