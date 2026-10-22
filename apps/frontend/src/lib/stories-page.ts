import { FOLDER_SYSTEM_TYPE } from '@nao/shared/types';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { StoryFormat, StorySharingInfo, StorySummary, SummarySegment } from '@nao/shared/types';
import type { QueryDataMap } from '@/components/story-embeds';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;

export type SortField = 'name' | 'owner' | 'updated' | 'created' | 'views';
export type SortDirection = 'asc' | 'desc';
export type SortState = { field: SortField; direction: SortDirection };
export type StoriesOwnerFilter = 'anyone' | 'me' | 'others';
export type StoriesFormatFilter = 'any' | StoryFormat;
export type StoriesFilters = {
	certifiedOnly: boolean;
	liveOnly: boolean;
	favoritesOnly: boolean;
	sharedOnly: boolean;
	owner: StoriesOwnerFilter;
	format: StoriesFormatFilter;
};

export const STORIES_DISPLAY_KEY = 'stories-display-mode';
export const STORIES_SORT_KEY = 'stories-sort';
export const DEFAULT_SORT: SortState = { field: 'updated', direction: 'desc' };
export const DEFAULT_FILTERS: StoriesFilters = {
	certifiedOnly: false,
	liveOnly: false,
	favoritesOnly: false,
	sharedOnly: false,
	owner: 'anyone',
	format: 'any',
};

const SORT_FIELDS: SortField[] = ['name', 'owner', 'updated', 'created', 'views'];

export function readStoredSort(): SortState {
	const raw = localStorage.getItem(STORIES_SORT_KEY);
	if (!raw) {
		return DEFAULT_SORT;
	}
	const [field, direction] = raw.split('-') as [SortField, SortDirection];
	if (SORT_FIELDS.includes(field) && (direction === 'asc' || direction === 'desc')) {
		return { field, direction };
	}
	return DEFAULT_SORT;
}

export function writeStoredSort(sort: SortState): void {
	localStorage.setItem(STORIES_SORT_KEY, `${sort.field}-${sort.direction}`);
}

export function isDateSortField(field: SortField): boolean {
	return field === 'updated' || field === 'created';
}

export function isTextSortField(field: SortField): boolean {
	return field === 'name' || field === 'owner';
}

export function defaultSortDirection(field: SortField): SortDirection {
	return isTextSortField(field) ? 'asc' : 'desc';
}

export function countActiveFilters(filters: StoriesFilters): number {
	return (
		Number(filters.certifiedOnly) +
		Number(filters.liveOnly) +
		Number(filters.favoritesOnly) +
		Number(filters.sharedOnly) +
		Number(filters.owner !== 'anyone') +
		Number(filters.format !== 'any')
	);
}

export type StoryItem = {
	storyId: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	author: string;
	kind: 'own' | 'own-standalone' | 'shared-with-me' | 'shared-project';
	chatId?: string;
	storySlug?: string;
	summary: StorySummary;
	kpiPreviewData: QueryDataMap | null;
	format: StoryFormat;
	version: number;
	isLive: boolean;
	isCertified: boolean;
	certifiedByName: string | null;
	isPinned: boolean;
	isFavorited: boolean;
	sharing: StorySharingInfo | null;
	isShared: boolean;
	viewCount: number;
	folderId: string | null;
	isInPrivateContext: boolean;
	link: { to: '/stories/$storyId'; params: { storyId: string } };
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
	viewCountByStoryId = {},
	folderItemMap,
	folders,
}: {
	userStories: OwnStoryListItem[];
	standaloneStories?: StandaloneStoryListItem[];
	sharedStories: SharedStoryListItem[];
	currentUserName: string;
	favoriteStoryIds?: string[];
	viewCountByStoryId?: Record<string, number>;
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
		const folderId = folderItemMap.get(story.id) ?? null;
		const isFavorited = favoriteSet.has(story.id);
		return {
			storyId: story.id,
			title: story.title,
			createdAt: new Date(story.createdAt),
			updatedAt: new Date(story.updatedAt),
			author: currentUserName,
			kind: 'own',
			chatId,
			storySlug: story.storySlug,
			summary: story.summary,
			kpiPreviewData: story.kpiPreviewData as QueryDataMap | null,
			format: story.format,
			version: story.version,
			isLive: story.isLive,
			isCertified: story.certifiedAt !== null,
			certifiedByName: story.certifiedByName,
			isPinned: sharedEntry?.isPinned ?? false,
			isFavorited,
			sharing: story.sharing,
			isShared: sharedEntry !== undefined,
			viewCount: viewCountByStoryId[story.id] ?? 0,
			folderId,
			isInPrivateContext: isPrivateContext(folderId, folders),
			link: storyLink(story.id),
		};
	});

	const standaloneItems: StoryItem[] = (standaloneStories ?? []).map((story) => {
		const folderId = folderItemMap.get(story.id) ?? null;
		const isFavorited = favoriteSet.has(story.id);
		return {
			storyId: story.id,
			title: story.title,
			createdAt: new Date(story.createdAt),
			updatedAt: new Date(story.updatedAt),
			author: currentUserName,
			kind: 'own-standalone',
			storySlug: story.storySlug,
			summary: story.summary,
			kpiPreviewData: story.kpiPreviewData as QueryDataMap | null,
			format: story.format,
			version: story.version,
			isLive: story.isLive,
			isCertified: story.certifiedAt !== null,
			certifiedByName: story.certifiedByName,
			isPinned: false,
			isFavorited,
			sharing: null,
			isShared: false,
			viewCount: viewCountByStoryId[story.id] ?? 0,
			folderId,
			isInPrivateContext: isPrivateContext(folderId, folders),
			link: storyLink(story.id),
		};
	});

	const sharedItems: StoryItem[] = Array.from(sharesByStoryId.values())
		.filter((share) => !ownStoryIds.has(share.storyId))
		.map((story) => {
			const folderId = folderItemMap.get(story.storyId) ?? null;
			const isFavorited = favoriteSet.has(story.storyId);
			return {
				storyId: story.storyId,
				title: story.title,
				createdAt: new Date(story.createdAt),
				updatedAt: new Date(story.updatedAt),
				author: story.authorName,
				kind: story.visibility === 'specific' ? 'shared-with-me' : ('shared-project' as const),
				summary: story.summary,
				kpiPreviewData: story.kpiPreviewData as QueryDataMap | null,
				format: story.format,
				version: story.version,
				isLive: story.isLive,
				isCertified: story.certifiedAt !== null,
				certifiedByName: story.certifiedByName,
				isPinned: story.isPinned,
				isFavorited,
				sharing: story.sharing,
				isShared: true,
				viewCount: viewCountByStoryId[story.storyId] ?? 0,
				folderId,
				isInPrivateContext: false,
				link: storyLink(story.storyId),
			};
		});

	return [...ownItems, ...standaloneItems, ...sharedItems];
}

export function filterStories(
	items: StoryItem[],
	query: string,
	filters: StoriesFilters = DEFAULT_FILTERS,
): StoryItem[] {
	const filteredItems = items.filter((item) => matchesFilters(item, filters));
	if (!query.trim()) {
		return filteredItems;
	}

	const lowerQuery = query.toLowerCase();
	return filteredItems.filter(
		(item) =>
			matchesStoryId(item, query) ||
			item.title.toLowerCase().includes(lowerQuery) ||
			item.author.toLowerCase().includes(lowerQuery) ||
			extractSummaryText(item.summary).toLowerCase().includes(lowerQuery),
	);
}

export function matchesStoryId(item: StoryItem, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return false;
	}
	return [item.storyId, item.chatId].some((id) => id?.toLowerCase() === normalizedQuery);
}

export function buildCurrentLevelEntries({
	items,
	folders,
	currentFolderId,
	sort,
	currentUserName,
	favoriteFolderIds,
	searchQuery = '',
	filters = DEFAULT_FILTERS,
}: {
	items: StoryItem[];
	folders: FolderItem[];
	currentFolderId: string | null;
	sort: SortState;
	currentUserName: string;
	favoriteFolderIds?: string[];
	searchQuery?: string;
	filters?: StoriesFilters;
}): { pinned: StoryItem[]; favorites: FavoriteEntry[]; entries: ExplorerEntry[] } {
	if (searchQuery.trim() || countActiveFilters(filters) > 0) {
		return buildResultEntries({ items, folders, currentFolderId, sort, currentUserName, searchQuery });
	}

	const favoriteFolderSet = new Set<string>(favoriteFolderIds ?? []);

	const pinned = items.filter((i) => i.isPinned).sort(compareCertifiedFirst);

	const favoriteStories: FavoriteEntry[] = items
		.filter((i) => !i.isPinned && i.isFavorited)
		.map((story) => ({ kind: 'story' as const, story, favoritedAt: story.createdAt }));

	const favoriteFolders: FavoriteEntry[] = folders
		.filter((f) => f.id !== '__shared_with_me__' && favoriteFolderSet.has(f.id))
		.map((folder) => ({ kind: 'folder' as const, folder, favoritedAt: folder.createdAt }));

	const favorites = [...favoriteStories, ...favoriteFolders].sort(
		(a, b) =>
			Number(isCertifiedEntry(b)) - Number(isCertifiedEntry(a)) ||
			b.favoritedAt.getTime() - a.favoritedAt.getTime(),
	);

	const inSharedWithMe = currentFolderId === '__shared_with_me__';
	const subfolders = inSharedWithMe ? [] : folders.filter((f) => f.parentId === currentFolderId);

	const systemFolders = subfolders.filter(isSystemFolder).sort((a, b) => systemFolderRank(a) - systemFolderRank(b));
	const regularFolders = subfolders.filter((f) => !isSystemFolder(f)).sort(compareFolderNames(sort));

	const storyEntries: ExplorerEntry[] = items
		.filter((item) => isAtCurrentLevel(item, currentFolderId))
		.map((story): ExplorerEntry => ({ kind: 'story', story }));
	storyEntries.sort(compareEntries(sort, currentUserName));

	const entries: ExplorerEntry[] = [
		...systemFolders.map((folder): ExplorerEntry => ({ kind: 'folder', folder })),
		...regularFolders.map((folder): ExplorerEntry => ({ kind: 'folder', folder })),
		...storyEntries,
	];

	return { pinned, favorites, entries };
}

/**
 * Searching or filtering shows a flat list of every matching story within the current folder and its subfolders.
 * A pasted story or chat ID matches from anywhere.
 */
function buildResultEntries({
	items,
	folders,
	currentFolderId,
	sort,
	currentUserName,
	searchQuery,
}: {
	items: StoryItem[];
	folders: FolderItem[];
	currentFolderId: string | null;
	sort: SortState;
	currentUserName: string;
	searchQuery: string;
}): { pinned: StoryItem[]; favorites: FavoriteEntry[]; entries: ExplorerEntry[] } {
	const isInScope = createFolderScopeMatcher(folders, currentFolderId);
	const entries: ExplorerEntry[] = items
		.filter((item) => isInScope(item) || matchesStoryId(item, searchQuery))
		.map((story): ExplorerEntry => ({ kind: 'story', story }));
	entries.sort(compareEntries(sort, currentUserName));
	return { pinned: [], favorites: [], entries };
}

function createFolderScopeMatcher(folders: FolderItem[], currentFolderId: string | null): (item: StoryItem) => boolean {
	if (currentFolderId === null) {
		return () => true;
	}
	if (currentFolderId === '__shared_with_me__') {
		return (item) => item.kind === 'shared-with-me';
	}
	const scopeFolderIds = collectFolderSubtreeIds(folders, currentFolderId);
	return (item) => item.folderId !== null && scopeFolderIds.has(item.folderId);
}

function collectFolderSubtreeIds(folders: FolderItem[], rootFolderId: string): Set<string> {
	const folderIds = new Set<string>([rootFolderId]);
	const queue = [rootFolderId];
	while (queue.length > 0) {
		const parentId = queue.shift();
		for (const folder of folders) {
			if (folder.parentId === parentId && !folderIds.has(folder.id)) {
				folderIds.add(folder.id);
				queue.push(folder.id);
			}
		}
	}
	return folderIds;
}

function matchesFilters(item: StoryItem, filters: StoriesFilters): boolean {
	return (
		(!filters.certifiedOnly || item.isCertified) &&
		(!filters.liveOnly || item.isLive) &&
		(!filters.favoritesOnly || item.isFavorited) &&
		(!filters.sharedOnly || isSharedStory(item)) &&
		(filters.format === 'any' || item.format === filters.format) &&
		matchesOwnerFilter(item, filters.owner)
	);
}

function isSharedStory(item: StoryItem): boolean {
	return item.isShared || item.sharing !== null;
}

function matchesOwnerFilter(item: StoryItem, owner: StoriesOwnerFilter): boolean {
	if (owner === 'anyone') {
		return true;
	}
	const isOwnedByMe = item.kind === 'own' || item.kind === 'own-standalone';
	return owner === 'me' ? isOwnedByMe : !isOwnedByMe;
}

/**
 * Folders are always listed by name; only a name sort can flip their order.
 */
function compareFolderNames(sort: SortState): (a: FolderItem, b: FolderItem) => number {
	const multiplier = sort.field === 'name' && sort.direction === 'desc' ? -1 : 1;
	return (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
}

function storyLink(storyId: string): StoryItem['link'] {
	return { to: '/stories/$storyId', params: { storyId } };
}

function isAtCurrentLevel(item: StoryItem, currentFolderId: string | null): boolean {
	if (currentFolderId === '__shared_with_me__') {
		return item.kind === 'shared-with-me';
	}
	return item.folderId === currentFolderId && item.kind !== 'shared-with-me';
}

function systemFolderRank(folder: FolderItem): number {
	return folder.systemType == null ? 99 : FOLDER_SYSTEM_TYPE.indexOf(folder.systemType);
}

function compareCertifiedFirst(a: StoryItem, b: StoryItem): number {
	return Number(b.isCertified) - Number(a.isCertified);
}

function isCertifiedEntry(entry: ExplorerEntry): boolean {
	return entry.kind === 'story' && entry.story.isCertified;
}

function compareEntries(sort: SortState, currentUserName: string): (a: ExplorerEntry, b: ExplorerEntry) => number {
	return (a, b) => {
		const certifiedCmp = Number(isCertifiedEntry(b)) - Number(isCertifiedEntry(a));
		if (certifiedCmp !== 0) {
			return certifiedCmp;
		}

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

		const cmp = toComparableNumber(aVal) - toComparableNumber(bVal);
		if (cmp !== 0) {
			return cmp * mul;
		}
		return getNameFallback(a).localeCompare(getNameFallback(b));
	};
}

function toComparableNumber(value: string | number | Date): number {
	return value instanceof Date ? value.getTime() : Number(value);
}

function getSortValue(entry: ExplorerEntry, field: SortField, currentUserName: string): string | number | Date {
	if (field === 'name') {
		return getNameFallback(entry);
	}
	if (field === 'views') {
		return entry.kind === 'folder' ? 0 : entry.story.viewCount;
	}
	if (field === 'owner') {
		return entry.kind === 'folder' ? currentUserName : entry.story.author;
	}
	if (field === 'created') {
		return entry.kind === 'folder' ? entry.folder.createdAt : entry.story.createdAt;
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
		case 'map':
			return segment.title;
		case 'grid':
			return segment.children.map(extractSegmentText).join(' ');
	}
}
