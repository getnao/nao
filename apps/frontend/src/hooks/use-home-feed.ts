import { useCallback, useMemo, useState } from 'react';

import type { HomeFeedGroup, HomeFeedItem } from '@/lib/home-feed';
import type { HomeStoriesMode } from '@/lib/home-stories-mode';
import type { StoryItem } from '@/lib/stories-page';
import { useHomeRecommendations } from '@/hooks/use-home-recommendations';
import { buildLatestFeed, buildSmartFeed, groupLatestFeed, groupSmartFeed } from '@/lib/home-feed';
import { readHomeStoriesMode, writeHomeStoriesMode } from '@/lib/home-stories-mode';

export interface HomeFeed {
	mode: HomeStoriesMode;
	setMode: (mode: HomeStoriesMode) => void;
	items: HomeFeedItem[];
	groups: HomeFeedGroup[];
	isLoading: boolean;
}

/**
 * Picks what the homepage shows under the chat input: either the classic favorites / pinned / latest
 * stories, or the frecency + AI recommendations. When the smart feed has nothing to offer yet it
 * quietly falls back to the classic list so the page never looks empty.
 */
export function useHomeFeed({
	storyItems,
	limit,
	enabled,
}: {
	storyItems: StoryItem[];
	limit: number;
	enabled: boolean;
}): HomeFeed {
	const [mode, setModeState] = useState<HomeStoriesMode>(readHomeStoriesMode);
	const recommendations = useHomeRecommendations(enabled && mode === 'smart');

	const setMode = useCallback((next: HomeStoriesMode) => {
		setModeState(next);
		writeHomeStoriesMode(next);
	}, []);

	const latestItems = useMemo(() => buildLatestFeed(storyItems, limit), [storyItems, limit]);
	const smartItems = useMemo(
		() => buildSmartFeed(recommendations.data?.items ?? [], storyItems, limit),
		[recommendations.data, storyItems, limit],
	);

	const isSmartLoading = mode === 'smart' && recommendations.isPending && recommendations.fetchStatus !== 'idle';
	const useSmart = mode === 'smart' && smartItems.length > 0;
	const items = useSmart ? smartItems : latestItems;
	const groups = useMemo(() => (useSmart ? groupSmartFeed(items) : groupLatestFeed(items)), [useSmart, items]);

	return { mode, setMode, items, groups, isLoading: isSmartLoading };
}
