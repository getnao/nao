import { useEffect } from 'react';
import { ValueStore } from './value-store';
import type { StoryFilterSelections } from '@nao/shared/sql-template';

/** The story on screen with the filters it is shown with, sent with each message so the agent sees the same rows. */
interface ShownStoryFilters {
	storyId: string;
	selections: StoryFilterSelections;
}

const shownStoryFiltersStore = new ValueStore<ShownStoryFilters | null>(null);

export function getShownStoryFiltersRequestBody(): { storyFilters?: ShownStoryFilters } {
	const storyFilters = shownStoryFiltersStore.getSnapshot();
	return storyFilters ? { storyFilters } : {};
}

export function useShowStoryFilters(storyId: string | null, selections: StoryFilterSelections): void {
	useEffect(() => {
		if (!storyId || Object.keys(selections).length === 0) {
			return;
		}
		const shown = { storyId, selections };
		shownStoryFiltersStore.set(shown);
		return () => {
			if (shownStoryFiltersStore.getSnapshot() === shown) {
				shownStoryFiltersStore.set(null);
			}
		};
	}, [storyId, selections]);
}
