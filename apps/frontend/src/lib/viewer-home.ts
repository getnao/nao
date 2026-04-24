import type { MessageBubble } from '@nao/shared/types';

export type DisplayMode = 'grid' | 'lines';
export type GroupBy = 'type' | 'date' | 'author';

export const VIEWER_DISPLAY_KEY = 'viewer-home-display-mode';
export const VIEWER_GROUP_KEY = 'viewer-home-group-by';

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
	type: 'Type',
	date: 'Date',
	author: 'Author',
};

export type SharedItem = {
	id: string;
	kind: 'story' | 'chat';
	title: string;
	authorName: string;
	createdAt: Date;
	summary?: unknown;
	messageBubbles?: MessageBubble[];
};

export type SharedGroup = { label: string; items: SharedItem[] };

export function getStoredSetting<T extends string>(key: string, allowed: T[], fallback: T): T {
	const stored = localStorage.getItem(key);
	return allowed.includes(stored as T) ? (stored as T) : fallback;
}

export function filterItems(items: SharedItem[], query: string): SharedItem[] {
	const q = query.trim().toLowerCase();
	if (!q) {
		return items;
	}
	return items.filter((item) => item.title.toLowerCase().includes(q) || item.authorName.toLowerCase().includes(q));
}

export function groupItems(items: SharedItem[], groupBy: GroupBy): SharedGroup[] {
	if (items.length === 0) {
		return [];
	}

	switch (groupBy) {
		case 'type':
			return groupByType(items);
		case 'date':
			return groupByDate(items);
		case 'author':
			return groupByAuthor(items);
	}
}

function groupByType(items: SharedItem[]): SharedGroup[] {
	const storyItems = items.filter((i) => i.kind === 'story');
	const chatItems = items.filter((i) => i.kind === 'chat');
	const groups: SharedGroup[] = [];

	if (storyItems.length > 0) {
		groups.push({ label: 'Stories', items: storyItems });
	}
	if (chatItems.length > 0) {
		groups.push({ label: 'Chats', items: chatItems });
	}

	return groups;
}

function groupByDate(items: SharedItem[]): SharedGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterdayStart = new Date(todayStart);
	yesterdayStart.setDate(todayStart.getDate() - 1);
	const weekStart = new Date(todayStart);
	weekStart.setDate(todayStart.getDate() - todayStart.getDay());
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

	const buckets: Record<string, SharedItem[]> = {
		Today: [],
		Yesterday: [],
		'This Week': [],
		'This Month': [],
		Older: [],
	};

	const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	for (const item of sorted) {
		const ts = item.createdAt.getTime();
		if (ts >= todayStart.getTime()) {
			buckets['Today'].push(item);
		} else if (ts >= yesterdayStart.getTime()) {
			buckets['Yesterday'].push(item);
		} else if (ts >= weekStart.getTime()) {
			buckets['This Week'].push(item);
		} else if (ts >= monthStart.getTime()) {
			buckets['This Month'].push(item);
		} else {
			buckets['Older'].push(item);
		}
	}

	return Object.entries(buckets)
		.filter(([, bucket]) => bucket.length > 0)
		.map(([label, bucket]) => ({ label, items: bucket }));
}

function groupByAuthor(items: SharedItem[]): SharedGroup[] {
	const map = new Map<string, SharedItem[]>();

	for (const item of items) {
		const group = map.get(item.authorName);
		if (group) {
			group.push(item);
		} else {
			map.set(item.authorName, [item]);
		}
	}

	return [...map.entries()].map(([label, group]) => ({ label, items: group }));
}
