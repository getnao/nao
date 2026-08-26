import { createContext, useContext, useMemo } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { ReactNode } from 'react';

import { storyThemeStyle, useStoryTheme } from '@/hooks/use-story-theme';
import { cn } from '@/lib/utils';

interface StoryThemeContextValue {
	theme: StoryTheme | null;
}

const StoryThemeContext = createContext<StoryThemeContextValue>({ theme: null });

export function useActiveStoryTheme(): StoryTheme | null {
	return useContext(StoryThemeContext).theme;
}

interface StoryThemeProviderProps {
	children: ReactNode;
	className?: string;
	/**
	 * Force a specific theme instead of the workspace's published one. Used by
	 * the admin review screen so the preview shows the draft, not what is live.
	 */
	override?: StoryTheme | null;
}

/**
 * Wraps a story in its workspace theme.
 *
 * The theme is applied as CSS custom properties on a single element, which is
 * why no story component had to change to support this: they already read
 * `--card`, `--foreground`, `--chart-1` and friends from whatever scope they
 * happen to sit in. Overriding those on an ancestor is enough.
 *
 * `data-story-themed` is the hook for the handful of story-only rules in
 * styles.css (heading face and tracking, control radius) that have no existing
 * token to ride on.
 */
export function StoryThemeProvider({ children, className, override }: StoryThemeProviderProps) {
	const { theme: published } = useStoryTheme();
	const theme = override !== undefined ? override : published;
	const style = useMemo(() => storyThemeStyle(theme), [theme]);
	const value = useMemo(() => ({ theme }), [theme]);

	return (
		<StoryThemeContext.Provider value={value}>
			<div
				className={cn('contents', className)}
				style={style}
				data-story-themed={theme ? 'true' : undefined}
				data-story-elevation={theme?.shape.elevation}
			>
				{children}
			</div>
		</StoryThemeContext.Provider>
	);
}
