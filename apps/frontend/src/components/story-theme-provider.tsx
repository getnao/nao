import { createContext, useContext, useEffect, useMemo } from 'react';
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
/**
 * Load the theme's font stylesheets.
 *
 * A font-family string alone changes nothing: without a stylesheet serving the
 * face the browser silently falls back, which is why the first cut of this
 * feature rendered every brand in Arial. Links are appended to <head> because
 * webfonts must be loaded document-wide, and reference-counted so unmounting
 * one story does not yank a face another view is still using.
 */
const linkRefCounts = new Map<string, number>();

function useFontLinks(hrefs: string[]) {
	const key = hrefs.join('|');
	useEffect(() => {
		if (!key) {
			return;
		}
		const urls = key.split('|');
		for (const href of urls) {
			linkRefCounts.set(href, (linkRefCounts.get(href) ?? 0) + 1);
			// Ensure the element exists regardless of the count. Keying insertion
			// off `count === 0` meant that if a cleanup removed the tag while the
			// count was still above zero - which happens when themes change in
			// quick succession, as they do when an admin tries several sites in a
			// row - no later mount would ever put it back, and the brand face
			// silently stopped loading.
			if (!document.querySelector(`link[data-story-font="${CSS.escape(href)}"]`)) {
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = href;
				link.dataset.storyFont = href;
				document.head.appendChild(link);
			}
		}
		return () => {
			for (const href of urls) {
				const next = (linkRefCounts.get(href) ?? 1) - 1;
				linkRefCounts.set(href, next);
				if (next <= 0) {
					linkRefCounts.delete(href);
					document.querySelector(`link[data-story-font="${CSS.escape(href)}"]`)?.remove();
				}
			}
		};
	}, [key]);
}

export function StoryThemeProvider({ children, className, override }: StoryThemeProviderProps) {
	const { theme: published } = useStoryTheme();
	const theme = override !== undefined ? override : published;
	useFontLinks(theme?.typography.fontLinks ?? []);
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
