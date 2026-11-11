import { describe, expect, it } from 'vitest';

import { buildCurrentLevelEntries, DEFAULT_FILTERS, filterStories } from './stories-page';
import type { StoriesFilters, StoryItem } from './stories-page';

describe('stories library filters', () => {
	const items = [
		buildStory({ storyId: 'live-custom', isLive: true, format: 'custom' }),
		buildStory({ storyId: 'favorite', isFavorited: true }),
		buildStory({
			storyId: 'shared-by-me',
			sharing: { visibility: 'project', sharedWithCount: 0, sharedWithGroupCount: 0, isPinned: false },
		}),
		buildStory({ storyId: 'shared-with-me', kind: 'shared-with-me', isShared: true }),
	];

	it.each<[Partial<StoriesFilters>, string[]]>([
		[{ liveOnly: true }, ['live-custom']],
		[{ favoritesOnly: true }, ['favorite']],
		[{ sharedOnly: true }, ['shared-by-me', 'shared-with-me']],
		[{ format: 'custom' }, ['live-custom']],
		[{ format: 'classic' }, ['favorite', 'shared-by-me', 'shared-with-me']],
		[{ sharedOnly: true, owner: 'me' }, ['shared-by-me']],
	])('keeps only stories matching %o', (filters, expectedIds) => {
		const result = filterStories(items, '', { ...DEFAULT_FILTERS, ...filters });

		expect(result.map((item) => item.storyId)).toEqual(expectedIds);
	});

	it('sorts results by analytics views', () => {
		const viewedItems = [
			buildStory({ storyId: 'few', viewCount: 2 }),
			buildStory({ storyId: 'many', viewCount: 40 }),
			buildStory({ storyId: 'none', viewCount: 0 }),
		];

		const { entries } = buildCurrentLevelEntries({
			items: viewedItems,
			folders: [],
			currentFolderId: null,
			sort: { field: 'views', direction: 'desc' },
			currentUserName: 'Me',
		});

		expect(entries.map((entry) => (entry.kind === 'story' ? entry.story.storyId : entry.folder.id))).toEqual([
			'many',
			'few',
			'none',
		]);
	});
});

function buildStory(overrides: Partial<StoryItem> & { storyId: string }): StoryItem {
	return {
		title: overrides.storyId,
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-01'),
		author: 'Me',
		kind: 'own',
		summary: { segments: [] },
		kpiPreviewData: null,
		format: 'classic',
		version: 1,
		isLive: false,
		isCertified: false,
		certifiedByName: null,
		isPinned: false,
		isFavorited: false,
		sharing: null,
		isShared: false,
		viewCount: 0,
		folderId: null,
		isInPrivateContext: false,
		link: { to: '/stories/$storyId', params: { storyId: overrides.storyId } },
		...overrides,
	};
}
