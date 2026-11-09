import { useState } from 'react';
import type { StoryTab } from '@nao/shared/story-tabs';

import { findCitedTabIndex } from '@/lib/cited-story-tab';
import { useCitedStoryElementRequest } from '@/stores/cited-story-element';
import { isStoryRequestFor } from '@/stores/story-highlight';

interface ActiveStoryTabOptions {
	tabs: StoryTab[] | null;
	storySlug?: string;
	initialIndex?: number;
}

export function useActiveStoryTab({ tabs, storySlug, initialIndex = 0 }: ActiveStoryTabOptions) {
	const [selectedIndex, setSelectedIndex] = useState(initialIndex);
	const [followedRequestId, setFollowedRequestId] = useState<number | null>(null);
	const request = useCitedStoryElementRequest();
	const activeIndex = tabs?.length ? Math.min(selectedIndex, tabs.length - 1) : 0;

	if (tabs?.length && request && request.id !== followedRequestId && isStoryRequestFor(request, storySlug)) {
		setFollowedRequestId(request.id);
		setSelectedIndex(findCitedTabIndex(tabs, request.element, activeIndex) ?? activeIndex);
	}

	return [activeIndex, setSelectedIndex] as const;
}
