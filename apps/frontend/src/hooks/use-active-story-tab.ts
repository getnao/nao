import { useState } from 'react';
import type { StoryTab } from '@nao/shared/story-tabs';

import { findCitedTabIndex } from '@/lib/cited-story-tab';
import { useCitedStoryElementRequest } from '@/stores/cited-story-element';
import { isStoryRequestFor } from '@/stores/story-highlight';

interface ActiveStoryTabOptions {
	tabs: StoryTab[] | null;
	storySlug?: string;
	initialIndex?: number;
	/** Selects each tab as it appears, so a streaming story shows the tab being written. */
	followNewTabs?: boolean;
}

export function useActiveStoryTab({ tabs, storySlug, initialIndex = 0, followNewTabs = false }: ActiveStoryTabOptions) {
	const [selectedIndex, setSelectedIndex] = useState(initialIndex);
	const [followedRequestId, setFollowedRequestId] = useState<number | null>(null);
	const [followedTabCount, setFollowedTabCount] = useState(0);
	const request = useCitedStoryElementRequest();
	const activeIndex = tabs?.length ? Math.min(selectedIndex, tabs.length - 1) : 0;
	const tabCount = followNewTabs ? (tabs?.length ?? 0) : 0;

	if (tabCount !== followedTabCount) {
		setFollowedTabCount(tabCount);
		if (tabCount > followedTabCount) {
			setSelectedIndex(tabCount - 1);
		}
	}

	if (tabs?.length && request && request.id !== followedRequestId && isStoryRequestFor(request, storySlug)) {
		setFollowedRequestId(request.id);
		setSelectedIndex(findCitedTabIndex(tabs, request.element, activeIndex) ?? activeIndex);
	}

	return [activeIndex, setSelectedIndex] as const;
}
