import { useQuery } from '@tanstack/react-query';
import type { StoryTheme } from '@nao/shared/story-theme';

import { useStoryThemeForCurrentMode } from '@/components/story-theme-provider';
import { trpc } from '@/main';

export function useActiveStoryTheme(): StoryTheme | null {
	const { data: activeTheme } = useQuery(trpc.storyTheme.getActive.queryOptions());
	return useStoryThemeForCurrentMode(activeTheme?.theme);
}
