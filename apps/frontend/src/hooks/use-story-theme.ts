import { useQuery } from '@tanstack/react-query';
import type { StoryTheme } from '@nao/shared/story-theme';

import { trpc } from '@/main';

export interface ActiveStoryTheme {
	theme: StoryTheme | null;
	isLoading: boolean;
}

export function useStoryTheme(): ActiveStoryTheme {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const enabled = config.data?.betaCustomStoriesEnabled === true;
	const { data, isLoading } = useQuery({
		...trpc.storyTheme.getActive.queryOptions(),
		enabled,
		staleTime: 5 * 60_000,
	});
	return { theme: enabled ? (data?.theme ?? null) : null, isLoading: enabled && isLoading };
}
