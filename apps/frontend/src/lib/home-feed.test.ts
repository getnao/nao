import { describe, expect, it } from 'vitest';
import { buildLatestFeed, buildSmartFeed, groupLatestFeed, groupSmartFeed } from './home-feed';
import type { HomeRecommendation } from './home-feed';
import type { StoryItem } from './stories-page';

function story(overrides: Partial<StoryItem> & { storyId: string; createdAt: Date }): StoryItem {
	return {
		id: overrides.storyId,
		title: overrides.storyId,
		updatedAt: overrides.createdAt,
		author: 'me',
		kind: 'own',
		summary: { segments: [] },
		isLive: false,
		isPinned: false,
		isFavorited: false,
		sharing: null,
		folderId: null,
		isInPrivateContext: false,
		link: { to: '/stories/standalone/$storyId', params: { storyId: overrides.storyId } },
		...overrides,
	};
}

function recommendation(
	overrides: Partial<HomeRecommendation> & { kind: 'story' | 'chat'; id: string },
): HomeRecommendation {
	return {
		shareId: null,
		isOwn: true,
		title: overrides.id,
		authorName: 'me',
		createdAt: new Date('2026-09-01T00:00:00Z'),
		reason: 'Opened 3 times this week',
		score: 1,
		...overrides,
	};
}

const day = (offset: number) => new Date(2026, 8, 1 + offset);

describe('buildLatestFeed', () => {
	it('orders favorites, then pinned, then newest and applies the limit', () => {
		const items = [
			story({ storyId: 'old', createdAt: day(0) }),
			story({ storyId: 'new', createdAt: day(5) }),
			story({ storyId: 'pinned', createdAt: day(1), isPinned: true }),
			story({ storyId: 'favorite', createdAt: day(2), isFavorited: true }),
		];

		const feed = buildLatestFeed(items, 3);

		expect(feed.map((item) => item.key)).toEqual(['favorite', 'pinned', 'new']);
		expect(feed.every((item) => item.reason === null)).toBe(true);
	});
});

describe('groupLatestFeed', () => {
	it('labels each non-empty group with the right plural', () => {
		const feed = buildLatestFeed(
			[
				story({ storyId: 'a', createdAt: day(0), isFavorited: true }),
				story({ storyId: 'b', createdAt: day(1) }),
				story({ storyId: 'c', createdAt: day(2) }),
			],
			3,
		);

		expect(groupLatestFeed(feed).map((group) => [group.label, group.items.length])).toEqual([
			['Favorite story', 1],
			['Latest stories', 2],
		]);
	});
});

describe('buildSmartFeed', () => {
	it('keeps the server order, resolves stories from the library and builds chat cards', () => {
		const library = [story({ storyId: 's1', createdAt: day(0) }), story({ storyId: 's2', createdAt: day(1) })];
		const recommendations = [
			recommendation({ kind: 'chat', id: 'c1', reason: 'Your end-of-day check-in' }),
			recommendation({ kind: 'story', id: 's2' }),
			recommendation({ kind: 'story', id: 'archived' }),
			recommendation({ kind: 'story', id: 's1' }),
		];

		const feed = buildSmartFeed(recommendations, library, 3);

		expect(feed.map((item) => item.key)).toEqual(['chat-c1', 'story-s2', 'story-s1']);
		expect(feed[0]).toMatchObject({ kind: 'chat', reason: 'Your end-of-day check-in' });
		expect(feed[0].kind === 'chat' && feed[0].chat.createdAt).toBeInstanceOf(Date);
	});

	it('stops at the limit', () => {
		const recommendations = ['c1', 'c2', 'c3'].map((id) => recommendation({ kind: 'chat', id }));
		expect(buildSmartFeed(recommendations, [], 2)).toHaveLength(2);
	});

	it('groups everything under a single "For you" header', () => {
		const feed = buildSmartFeed([recommendation({ kind: 'chat', id: 'c1' })], [], 3);
		expect(groupSmartFeed(feed)).toEqual([{ key: 'smart', label: 'For you', items: feed }]);
		expect(groupSmartFeed([])).toEqual([]);
	});
});
