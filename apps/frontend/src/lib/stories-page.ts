import type { StorySummary, SummarySegment } from '@/components/story-thumbnail';

export type DisplayMode = 'grid' | 'lines';
export type GroupBy = 'ownership' | 'date' | 'user';

export const STORIES_DISPLAY_KEY = 'stories-display-mode';
export const STORIES_GROUP_KEY = 'stories-group-by';

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
	ownership: 'Ownership',
	date: 'Date',
	user: 'User',
};

export type StoryItem = {
	id: string;
	title: string;
	createdAt: Date;
	author: string;
	kind: 'own' | 'shared-with-me' | 'shared-project';
	summary: StorySummary;
	link:
		| { to: '/stories/preview/$chatId/$storyId'; params: { chatId: string; storyId: string } }
		| { to: '/stories/shared/$shareId'; params: { shareId: string } };
};

export type StoryGroup = { label: string; items: StoryItem[] };

export type OwnStoryListItem = {
	chatId: string;
	storyId: string;
	title: string;
	createdAt: Date | string;
	summary: StorySummary;
};

export type SharedStoryListItem = {
	id: string;
	userId: string;
	chatId: string;
	storyId: string;
	title: string;
	createdAt: Date | string;
	authorName: string;
	visibility: 'specific' | 'project' | string;
	summary: StorySummary;
};

export function getStoredSetting<T extends string>(key: string, allowed: T[], fallback: T): T {
	const value = localStorage.getItem(key);
	return allowed.includes(value as T) ? (value as T) : fallback;
}

export function buildStoryItems({
	userStories,
	sharedStories,
	currentUserId,
	currentUserName,
}: {
	userStories: OwnStoryListItem[];
	sharedStories: SharedStoryListItem[];
	currentUserId?: string;
	currentUserName: string;
}): StoryItem[] {
	const ownShareMap = new Map<string, string>();
	for (const story of sharedStories) {
		if (story.userId === currentUserId) {
			const key = `${story.chatId}-${story.storyId}`;
			if (!ownShareMap.has(key)) {
				ownShareMap.set(key, story.id);
			}
		}
	}

	const ownItems: StoryItem[] = userStories.map((story) => {
		const shareId = ownShareMap.get(`${story.chatId}-${story.storyId}`);
		return {
			id: `${story.chatId}-${story.storyId}`,
			title: story.title,
			createdAt: new Date(story.createdAt),
			author: currentUserName,
			kind: 'own',
			summary: story.summary,
			link: shareId
				? { to: '/stories/shared/$shareId', params: { shareId } }
				: {
						to: '/stories/preview/$chatId/$storyId',
						params: { chatId: story.chatId, storyId: story.storyId },
					},
		};
	});

	const sharedItems: StoryItem[] = sharedStories
		.filter((story) => story.userId !== currentUserId)
		.map((story) => ({
			id: story.id,
			title: story.title,
			createdAt: new Date(story.createdAt),
			author: story.authorName,
			kind: story.visibility === 'specific' ? 'shared-with-me' : 'shared-project',
			summary: story.summary,
			link: { to: '/stories/shared/$shareId', params: { shareId: story.id } },
		}));

	return [...ownItems, ...sharedItems];
}

export function filterStories(items: StoryItem[], query: string): StoryItem[] {
	if (!query.trim()) {
		return items;
	}

	const lowerQuery = query.toLowerCase();
	return items.filter(
		(item) =>
			item.title.toLowerCase().includes(lowerQuery) ||
			item.author.toLowerCase().includes(lowerQuery) ||
			extractSummaryText(item.summary).toLowerCase().includes(lowerQuery),
	);
}

export function groupStories(items: StoryItem[], groupBy: GroupBy): StoryGroup[] {
	if (items.length === 0) {
		return [];
	}

	switch (groupBy) {
		case 'ownership':
			return groupByOwnership(items);
		case 'date':
			return groupByDate(items);
		case 'user':
			return groupByUser(items);
	}
}

function groupByOwnership(items: StoryItem[]): StoryGroup[] {
	const own = items.filter((item) => item.kind === 'own');
	const sharedWithMe = items.filter((item) => item.kind === 'shared-with-me');
	const sharedProject = items.filter((item) => item.kind === 'shared-project');
	const groups: StoryGroup[] = [];

	if (own.length > 0) {
		groups.push({ label: 'My Stories', items: own });
	}
	if (sharedWithMe.length > 0) {
		groups.push({ label: 'Shared with Me', items: sharedWithMe });
	}
	if (sharedProject.length > 0) {
		groups.push({ label: 'Shared with the Project', items: sharedProject });
	}

	return groups;
}

function groupByDate(items: StoryItem[]): StoryGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
	const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86_400_000);
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

	const buckets: Record<string, StoryItem[]> = {
		Today: [],
		Yesterday: [],
		'This Week': [],
		'This Month': [],
		Older: [],
	};

	const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	for (const item of sorted) {
		const timestamp = item.createdAt.getTime();
		if (timestamp >= todayStart.getTime()) {
			buckets['Today'].push(item);
		} else if (timestamp >= yesterdayStart.getTime()) {
			buckets['Yesterday'].push(item);
		} else if (timestamp >= weekStart.getTime()) {
			buckets['This Week'].push(item);
		} else if (timestamp >= monthStart.getTime()) {
			buckets['This Month'].push(item);
		} else {
			buckets.Older.push(item);
		}
	}

	return Object.entries(buckets)
		.filter(([, bucket]) => bucket.length > 0)
		.map(([label, bucket]) => ({ label, items: bucket }));
}

function groupByUser(items: StoryItem[]): StoryGroup[] {
	const groupedByAuthor = new Map<string, StoryItem[]>();

	for (const item of items) {
		const group = groupedByAuthor.get(item.author);
		if (group) {
			group.push(item);
		} else {
			groupedByAuthor.set(item.author, [item]);
		}
	}

	return [...groupedByAuthor.entries()].map(([label, group]) => ({ label, items: group }));
}

function extractSummaryText(summary: StorySummary): string {
	return summary.segments.map(extractSegmentText).join(' ');
}

function extractSegmentText(segment: SummarySegment): string {
	switch (segment.type) {
		case 'text':
			return segment.content;
		case 'chart':
			return segment.title;
		case 'table':
			return segment.title;
		case 'grid':
			return segment.children.map(extractSegmentText).join(' ');
	}
}
