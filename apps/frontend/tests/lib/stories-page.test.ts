import { describe, expect, it } from 'vitest';

import type { FolderItem, FolderShareAudience, StoriesFilters, StoryItem } from '@/lib/stories-page';
import {
	buildCurrentLevelEntries,
	DEFAULT_FILTERS,
	DEFAULT_SORT,
	filterStories,
	listFittingFolders,
	pickDefaultFolderId,
} from '@/lib/stories-page';

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

describe('story folder for a share', () => {
	const tree = [
		buildFolder('private', { visibility: 'private', systemType: 'private_folder' }),
		buildFolder('open'),
		buildFolder('sales', { teamGroupIds: ['sales-group'] }),
		buildFolder('sales-emea', { parentId: 'sales', teamGroupIds: ['sales-group'] }),
		buildFolder('board', { teamGroupIds: ['board-group', 'sales-group'] }),
	];
	const project: FolderShareAudience = { visibility: 'project', groupIds: [] };
	const sales: FolderShareAudience = { visibility: 'specific', groupIds: ['sales-group'] };
	const people: FolderShareAudience = { visibility: 'specific', groupIds: [] };

	it.each<[string, FolderShareAudience, (string | null)[], (string | null)[], string | null]>([
		['the project', project, [null, 'open'], ['private', 'sales'], null],
		['a group', sales, ['private', 'sales', 'sales-emea'], ['board', 'sales-emea'], 'sales-emea'],
		['people only', people, ['private'], ['sales'], 'private'],
	])(
		'offers folders that fit a share with %s, preferring the first one that fits',
		(_, share, fitting, preferred, picked) => {
			const options = listFittingFolders(tree, share);

			expect(options.map((option) => option.id)).toEqual(fitting);
			expect(pickDefaultFolderId(options, tree, preferred)).toBe(picked);
		},
	);

	it('lists a story shared through a team folder in that folder, not in "Shared with me"', () => {
		const items = [
			buildStory({ storyId: 'in-team-folder', kind: 'shared-with-me', folderId: 'sales' }),
			buildStory({ storyId: 'loose', kind: 'shared-with-me' }),
		];
		const entriesIn = (currentFolderId: string) =>
			buildCurrentLevelEntries({
				items,
				folders: tree,
				currentFolderId,
				sort: DEFAULT_SORT,
				currentUserName: 'Me',
			}).entries.map((entry) => (entry.kind === 'story' ? entry.story.storyId : entry.folder.id));

		expect(entriesIn('sales')).toContain('in-team-folder');
		expect(entriesIn('__shared_with_me__')).toEqual(['loose']);
	});
});

function buildFolder(id: string, overrides: Partial<FolderItem> = {}): FolderItem {
	return {
		id,
		name: id,
		parentId: null,
		ownerId: 'owner',
		projectId: 'project',
		visibility: 'public',
		systemType: null,
		archivedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		storyCount: 0,
		teamGroupIds: [],
		teamGroupNames: [],
		...overrides,
	} as FolderItem;
}

function buildStory(overrides: Partial<StoryItem> & { storyId: string }): StoryItem {
	return {
		title: overrides.storyId,
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-01'),
		author: 'Me',
		kind: 'own',
		summary: { segments: [] },
		kpiPreviewData: null,
		canShowThumbnail: true,
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
