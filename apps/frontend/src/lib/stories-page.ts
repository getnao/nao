import { FOLDER_SYSTEM_TYPE } from '@nao/shared/types';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { StorySharingInfo, StorySummary, SummarySegment } from '@nao/shared/types';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;

export type SortField = 'name' | 'owner' | 'updated';
export type SortDirection = 'asc' | 'desc';
export type SortState = { field: SortField; direction: SortDirection };

export const STORIES_DISPLAY_KEY = 'stories-display-mode';
export const STORIES_SORT_KEY = 'stories-sort';
export const DEFAULT_SORT: SortState = { field: 'updated', direction: 'desc' };

export function readStoredSort(): SortState {
	const raw = localStorage.getItem(STORIES_SORT_KEY);
	if (!raw) {
		return DEFAULT_SORT;
	}
	const [field, direction] = raw.split('-') as [SortField, SortDirection];
	if (
		(field === 'name' || field === 'owner' || field === 'updated') &&
		(direction === 'asc' || direction === 'desc')
	) {
		return { field, direction };
	}
	return DEFAULT_SORT;
}

export function writeStoredSort(sort: SortState): void {
	localStorage.setItem(STORIES_SORT_KEY, `${sort.field}-${sort.direction}`);
}

export type StoryItem = {
	id: string;
	storyId: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	author: string;
	kind: 'own' | 'own-standalone' | 'shared-with-me' | 'shared-project';
	chatId?: string;
	storySlug?: string;
	summary: StorySummary;
	isLive: boolean;
	isPinned: boolean;
	isFavorited: boolean;
	sharing: StorySharingInfo | null;
	shareId?: string;
	sharedStoryId?: string;
	folderId: string | null;
	isInPrivateContext: boolean;
	link:
		| { to: '/stories/preview/$chatId/$storySlug'; params: { chatId: string; storySlug: string } }
		| { to: '/stories/shared/$shareId'; params: { shareId: string } }
		| { to: '/stories/standalone/$storyId'; params: { storyId: string } };
};

export type FolderItem = RouterOutputs['storyFolder']['listTree'][number];

export type ExplorerEntry = { kind: 'folder'; folder: FolderItem } | { kind: 'story'; story: StoryItem };

export type FavoriteEntry =
	| { kind: 'story'; story: StoryItem; favoritedAt: Date }
	| { kind: 'folder'; folder: FolderItem; favoritedAt: Date };

export type OwnStoryListItem = RouterOutputs['story']['listAll'][number];
export type StandaloneStoryListItem = RouterOutputs['story']['listStandalone'][number];
export type SharedStoryListItem = RouterOutputs['storyShare']['list'][number];

export function getStoredSetting<T extends string>(key: string, allowed: T[], fallback: T): T {
	const value = localStorage.getItem(key);
	return allowed.includes(value as T) ? (value as T) : fallback;
}

export function isSystemFolder(folder: FolderItem): boolean {
	return folder.systemType != null;
}

function isPrivateContext(folderId: string | null, folders: FolderItem[]): boolean {
	if (folderId === null) {
		return false;
	}
	let current: FolderItem | undefined = folders.find((f) => f.id === folderId);
	const visited = new Set<string>();
	while (current) {
		if (visited.has(current.id)) {
			break;
		}
		visited.add(current.id);
		if (current.visibility === 'private') {
			return true;
		}
		current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined;
	}
	return false;
}

export function buildStoryItems({
	userStories,
	standaloneStories,
	sharedStories,
	currentUserName,
	favoriteStoryIds,
	folderItemMap,
	folders,
}: {
	userStories: OwnStoryListItem[];
	standaloneStories?: StandaloneStoryListItem[];
	sharedStories: SharedStoryListItem[];
	currentUserName: string;
	favoriteStoryIds?: string[];
	folderItemMap: Map<string, string>;
	folders: FolderItem[];
}): StoryItem[] {
	const favoriteSet = new Set<string>(favoriteStoryIds ?? []);

	const ownStoryIds = new Set<string>([
		...userStories.map((s) => s.id),
		...(standaloneStories ?? []).map((s) => s.id),
	]);

	const sharesByStoryId = new Map<string, SharedStoryListItem>();
	for (const share of sharedStories) {
		sharesByStoryId.set(share.storyId, share);
	}

	const ownItems: StoryItem[] = userStories.map((story) => {
		const chatId = story.chatId!;
		const sharedEntry = sharesByStoryId.get(story.id);
		const shareId = sharedEntry?.id;
		const folderId = folderItemMap.get(story.id) ?? null;
		const isFavorited = favoriteSet.has(story.id);
		return {
			id: `${chatId}-${story.storySlug}`,
			storyId: story.id,
			title: story.title,
			createdAt: new Date(story.createdAt),
			updatedAt: new Date(story.updatedAt),
			author: currentUserName,
			kind: 'own',
			chatId,
			storySlug: story.storySlug,
			summary: story.summary,
			isLive: story.isLive,
			isPinned: sharedEntry?.isPinned ?? false,
			isFavorited,
			sharing: story.sharing,
			shareId,
			sharedStoryId: shareId,
			folderId,
			isInPrivateContext: isPrivateContext(folderId, folders),
			link: shareId
				? { to: '/stories/shared/$shareId', params: { shareId } }
				: {
						to: '/stories/preview/$chatId/$storySlug',
						params: { chatId, storySlug: story.storySlug },
					},
		};
	});

	const standaloneItems: StoryItem[] = (standaloneStories ?? []).map((story) => {
		const folderId = folderItemMap.get(story.id) ?? null;
		const isFavorited = favoriteSet.has(story.id);
		return {
			id: story.id,
			storyId: story.id,
			title: story.title,
			createdAt: new Date(story.createdAt),
			updatedAt: new Date(story.updatedAt),
			author: currentUserName,
			kind: 'own-standalone',
			storySlug: story.storySlug,
			summary: story.summary,
			isLive: story.isLive,
			isPinned: false,
			isFavorited,
			sharing: null,
			folderId,
			isInPrivateContext: isPrivateContext(folderId, folders),
			link: { to: '/stories/standalone/$storyId', params: { storyId: story.id } },
		};
	});

	const sharedItems: StoryItem[] = Array.from(sharesByStoryId.values())
		.filter((share) => !ownStoryIds.has(share.storyId))
		.map((story) => {
			const folderId = folderItemMap.get(story.storyId) ?? null;
			const isFavorited = favoriteSet.has(story.storyId);
			return {
				id: story.id,
				storyId: story.storyId,
				title: story.title,
				createdAt: new Date(story.createdAt),
				updatedAt: new Date(story.updatedAt),
				author: story.authorName,
				kind: story.visibility === 'specific' ? 'shared-with-me' : ('shared-project' as const),
				summary: story.summary,
				isLive: false,
				isPinned: story.isPinned,
				isFavorited,
				sharing: story.sharing,
				sharedStoryId: story.id,
				folderId,
				isInPrivateContext: false,
				link: { to: '/stories/shared/$shareId', params: { shareId: story.id } },
			};
		});

	return [...ownItems, ...standaloneItems, ...sharedItems];
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

export function buildCurrentLevelEntries({
	items,
	folders,
	currentFolderId,
	sort,
	currentUserName,
	favoriteFolderIds,
}: {
	items: StoryItem[];
	folders: FolderItem[];
	currentFolderId: string | null;
	sort: SortState;
	currentUserName: string;
	favoriteFolderIds?: string[];
}): { pinned: StoryItem[]; favorites: FavoriteEntry[]; entries: ExplorerEntry[] } {
	const favoriteFolderSet = new Set<string>(favoriteFolderIds ?? []);

	const pinned = items.filter((i) => i.isPinned);

	const favoriteStories: FavoriteEntry[] = items
		.filter((i) => !i.isPinned && i.isFavorited)
		.map((story) => ({ kind: 'story' as const, story, favoritedAt: story.createdAt }));

	const favoriteFolders: FavoriteEntry[] = folders
		.filter((f) => f.id !== '__shared_with_me__' && favoriteFolderSet.has(f.id))
		.map((folder) => ({ kind: 'folder' as const, folder, favoritedAt: folder.createdAt }));

	const favorites = [...favoriteStories, ...favoriteFolders].sort(
		(a, b) => b.favoritedAt.getTime() - a.favoritedAt.getTime(),
	);

	const inSharedWithMe = currentFolderId === '__shared_with_me__';
	const subfolders = inSharedWithMe ? [] : folders.filter((f) => f.parentId === currentFolderId);

	const rest = inSharedWithMe
		? items.filter((i) => i.kind === 'shared-with-me')
		: items.filter((i) => i.folderId === currentFolderId && i.kind !== 'shared-with-me');

	const systemFolders = subfolders.filter(isSystemFolder).sort((a, b) => systemFolderRank(a) - systemFolderRank(b));
	const regularFolders = subfolders.filter((f) => !isSystemFolder(f));

	const regularEntries: ExplorerEntry[] = [
		...regularFolders.map((folder): ExplorerEntry => ({ kind: 'folder', folder })),
		...rest.map((story): ExplorerEntry => ({ kind: 'story', story })),
	];
	regularEntries.sort(compareEntries(sort, currentUserName));

	const entries: ExplorerEntry[] = [
		...systemFolders.map((folder): ExplorerEntry => ({ kind: 'folder', folder })),
		...regularEntries,
	];

	return { pinned, favorites, entries };
}

function systemFolderRank(folder: FolderItem): number {
	return folder.systemType == null ? 99 : FOLDER_SYSTEM_TYPE.indexOf(folder.systemType);
}

function compareEntries(sort: SortState, currentUserName: string): (a: ExplorerEntry, b: ExplorerEntry) => number {
	return (a, b) => {
		const aVal = getSortValue(a, sort.field, currentUserName);
		const bVal = getSortValue(b, sort.field, currentUserName);
		const mul = sort.direction === 'asc' ? 1 : -1;

		if (typeof aVal === 'string' && typeof bVal === 'string') {
			const cmp = aVal.localeCompare(bVal);
			if (cmp !== 0) {
				return cmp * mul;
			}
			return getNameFallback(a).localeCompare(getNameFallback(b));
		}

		if (aVal instanceof Date && bVal instanceof Date) {
			const cmp = aVal.getTime() - bVal.getTime();
			if (cmp !== 0) {
				return cmp * mul;
			}
			return getNameFallback(a).localeCompare(getNameFallback(b));
		}

		return 0;
	};
}

function getSortValue(entry: ExplorerEntry, field: SortField, currentUserName: string): string | Date {
	if (field === 'name') {
		return getNameFallback(entry);
	}
	if (field === 'owner') {
		return entry.kind === 'folder' ? currentUserName : entry.story.author;
	}
	return entry.kind === 'folder' ? entry.folder.updatedAt : entry.story.updatedAt;
}

function getNameFallback(entry: ExplorerEntry): string {
	return entry.kind === 'folder' ? entry.folder.name : entry.story.title;
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
