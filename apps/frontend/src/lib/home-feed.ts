import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { RecommendedChat } from '@/components/home-recommended-chat-card';
import type { StoryItem } from '@/lib/stories-page';

export type HomeRecommendation = inferRouterOutputs<TrpcRouter>['homeRecommendation']['list']['items'][number];

export type HomeFeedItem =
	| { kind: 'story'; key: string; story: StoryItem; reason: string | null }
	| { kind: 'chat'; key: string; chat: RecommendedChat; reason: string | null };

export type HomeFeedGroup = { key: string; label: string; items: HomeFeedItem[] };

export function buildLatestFeed(items: StoryItem[], limit: number): HomeFeedItem[] {
	return [...items]
		.sort(compareLatestStories)
		.slice(0, limit)
		.map((story) => ({ kind: 'story', key: story.id, story, reason: null }));
}

/** Turns server recommendations into feed items, dropping stories the user can no longer see in their library. */
export function buildSmartFeed(
	recommendations: HomeRecommendation[],
	storyItems: StoryItem[],
	limit: number,
): HomeFeedItem[] {
	const storiesById = new Map(storyItems.map((item) => [item.storyId, item]));
	const feed: HomeFeedItem[] = [];

	for (const recommendation of recommendations) {
		if (feed.length >= limit) {
			break;
		}
		const item = toFeedItem(recommendation, storiesById);
		if (item) {
			feed.push(item);
		}
	}

	return feed;
}

export function groupLatestFeed(items: HomeFeedItem[]): HomeFeedGroup[] {
	const favorites = items.filter((item) => isFavoriteStory(item));
	const pinned = items.filter((item) => !isFavoriteStory(item) && isPinnedStory(item));
	const latest = items.filter((item) => !isFavoriteStory(item) && !isPinnedStory(item));
	const groups: HomeFeedGroup[] = [
		{
			key: 'favorites',
			label: pluralize('Favorite story', 'Favorite stories', favorites.length),
			items: favorites,
		},
		{ key: 'pinned', label: pluralize('Pinned story', 'Pinned stories', pinned.length), items: pinned },
		{ key: 'latest', label: pluralize('Latest story', 'Latest stories', latest.length), items: latest },
	];
	return groups.filter((group) => group.items.length > 0);
}

export function groupSmartFeed(items: HomeFeedItem[]): HomeFeedGroup[] {
	if (items.length === 0) {
		return [];
	}
	return [{ key: 'smart', label: 'For you', items }];
}

function toFeedItem(recommendation: HomeRecommendation, storiesById: Map<string, StoryItem>): HomeFeedItem | null {
	if (recommendation.kind === 'story') {
		const story = storiesById.get(recommendation.id);
		if (!story) {
			return null;
		}
		return { kind: 'story', key: `story-${recommendation.id}`, story, reason: recommendation.reason };
	}
	return {
		kind: 'chat',
		key: `chat-${recommendation.id}`,
		chat: {
			id: recommendation.id,
			shareId: recommendation.shareId,
			title: recommendation.title,
			authorName: recommendation.authorName,
			createdAt: new Date(recommendation.createdAt),
			messageBubbles: recommendation.messageBubbles,
		},
		reason: recommendation.reason,
	};
}

function compareLatestStories(a: StoryItem, b: StoryItem): number {
	const rankDiff = storyPriorityRank(a) - storyPriorityRank(b);
	if (rankDiff !== 0) {
		return rankDiff;
	}
	return b.createdAt.getTime() - a.createdAt.getTime();
}

function storyPriorityRank(item: StoryItem): number {
	if (item.isFavorited) {
		return 0;
	}
	if (item.isPinned || (item.sharing?.isPinned ?? false)) {
		return 1;
	}
	return 2;
}

function isFavoriteStory(item: HomeFeedItem): boolean {
	return item.kind === 'story' && item.story.isFavorited;
}

function isPinnedStory(item: HomeFeedItem): boolean {
	return item.kind === 'story' && (item.story.isPinned || (item.story.sharing?.isPinned ?? false));
}

function pluralize(singular: string, plural: string, count: number): string {
	return count === 1 ? singular : plural;
}
