import { DEFAULT_STORY_THEME, storyThemeToCssVars } from '@nao/shared/story-theme';
import { useQuery } from '@tanstack/react-query';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { CSSProperties } from 'react';

import { trpc } from '@/main';

export interface StoryThemeState {
	/** The published theme, or null when the workspace runs the nao look. */
	theme: StoryTheme | null;
	enabled: boolean;
	isLoading: boolean;
}

/**
 * The published story theme for this workspace.
 *
 * Cached generously: it changes when an admin publishes, which is rare, and it
 * is read on every story render.
 */
export function useStoryTheme(): StoryThemeState {
	const { data, isLoading } = useQuery({
		...trpc.storyTheme.getActive.queryOptions(),
		staleTime: 5 * 60_000,
	});
	return {
		theme: (data?.theme as StoryTheme | null) ?? null,
		enabled: data?.enabled ?? false,
		isLoading,
	};
}

/**
 * Turn a theme into inline custom properties for a story container.
 *
 * Scoped rather than global on purpose: the story restyles, the surrounding nao
 * chrome does not. An admin who themes stories for their business users should
 * not find their own sidebar repainted.
 */
export function storyThemeStyle(theme: StoryTheme | null): CSSProperties {
	if (!theme) {
		return {};
	}
	return storyThemeToCssVars(theme) as CSSProperties;
}

export { DEFAULT_STORY_THEME };
