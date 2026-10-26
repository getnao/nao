import { DATABASE_MENTION_TRIGGER } from '@nao/shared';
import type { ChatArtifacts } from './chat-artifacts';

export type LibraryItemType = 'story' | 'query' | 'file' | 'chat';
export type LibrarySectionId = 'this-chat' | 'mine' | 'shared';
export type LibraryTypeFilter = LibraryItemType | 'all';

export const LIBRARY_SECTIONS: { id: LibrarySectionId; title: string; emptyLabel: string }[] = [
	{ id: 'this-chat', title: 'This chat', emptyLabel: 'Nothing produced or uploaded in this chat yet.' },
	{ id: 'mine', title: 'Mine', emptyLabel: 'No stories or queries of yours match.' },
	{ id: 'shared', title: 'Shared with me', emptyLabel: 'Nothing shared with you matches.' },
];

export const LIBRARY_TYPE_LABELS: Record<LibraryItemType, { singular: string; plural: string }> = {
	story: { singular: 'Story', plural: 'Stories' },
	query: { singular: 'Query', plural: 'Queries' },
	file: { singular: 'File', plural: 'Files' },
	chat: { singular: 'Chat', plural: 'Chats' },
};

export const LIBRARY_MENTION_PREFIX = 'library:';
export const LIBRARY_MENTION_TRIGGER = DATABASE_MENTION_TRIGGER;
export const LIBRARY_ITEM_DRAG_TYPE = 'application/x-nao-library-item';

export interface LibraryMention {
	id: string;
	label: string;
}

export interface LibraryItem {
	id: string;
	type: LibraryItemType;
	name: string;
	section: LibrarySectionId;
	updatedAt: number;
	detail?: string;
	originChatTitle?: string;
	sharedBy?: string;
	fileOrigin?: 'uploaded' | 'generated';
	content: LibraryItemContent;
}

export type LibraryItemContent =
	| { kind: 'chat-story'; storySlug: string }
	| { kind: 'chat-query'; toolCallId: string }
	| { kind: 'chat-file'; path: string; filename: string }
	| { kind: 'mock-story'; story: MockStory }
	| { kind: 'mock-query'; query: MockQuery }
	| { kind: 'mock-file'; preview: MockFilePreview }
	| { kind: 'mock-chat'; messages: MockChatMessage[] };

export interface MockStory {
	subtitle: string;
	blocks: MockStoryBlock[];
}

export type MockStoryBlock =
	| { id: string; kind: 'heading'; text: string }
	| { id: string; kind: 'text'; text: string }
	| { id: string; kind: 'kpis'; kpis: { label: string; value: string; delta: string; isPositive: boolean }[] }
	| {
			id: string;
			kind: 'chart';
			title: string;
			chartType: 'bar' | 'line';
			points: { label: string; value: number }[];
	  };

export interface MockQuery {
	id: `query_${string}`;
	sql: string;
	dialect: string;
	columns: string[];
	rows: Record<string, unknown>[];
}

export type MockFilePreview =
	| { kind: 'table'; columns: string[]; rows: Record<string, unknown>[] }
	| { kind: 'slides'; slides: { title: string; caption: string }[] };

export interface MockChatMessage {
	role: 'user' | 'assistant';
	text: string;
}

export interface LibraryFilters {
	search: string;
	type: LibraryTypeFilter;
}

export function filterLibraryItems(items: LibraryItem[], filters: LibraryFilters): LibraryItem[] {
	const search = filters.search.trim().toLowerCase();
	return items.filter(
		(item) => (filters.type === 'all' || item.type === filters.type) && (!search || matchesSearch(item, search)),
	);
}

export function groupLibraryItemsBySection(items: LibraryItem[]): Record<LibrarySectionId, LibraryItem[]> {
	const groups: Record<LibrarySectionId, LibraryItem[]> = { 'this-chat': [], mine: [], shared: [] };
	for (const item of items) {
		groups[item.section].push(item);
	}
	return groups;
}

export function countLibraryItemsByType(items: LibraryItem[]): Record<LibraryTypeFilter, number> {
	const counts: Record<LibraryTypeFilter, number> = { all: items.length, story: 0, query: 0, file: 0, chat: 0 };
	for (const item of items) {
		counts[item.type] += 1;
	}
	return counts;
}

export function buildChatArtifactItems(artifacts: ChatArtifacts, chatTitle: string | undefined): LibraryItem[] {
	const now = Date.now();
	return [
		...artifacts.stories.map(
			(story): LibraryItem => ({
				id: `chat-story:${story.id}`,
				type: 'story',
				name: story.title || story.id,
				section: 'this-chat',
				updatedAt: now,
				originChatTitle: chatTitle,
				content: { kind: 'chat-story', storySlug: story.id },
			}),
		),
		...artifacts.queries.map(
			(query): LibraryItem => ({
				id: `chat-query:${query.id}`,
				type: 'query',
				name: query.title || query.id,
				section: 'this-chat',
				updatedAt: now,
				detail: describeRowCount(query.rowCount),
				originChatTitle: chatTitle,
				content: { kind: 'chat-query', toolCallId: query.toolCallId },
			}),
		),
		...artifacts.files.map(
			(file): LibraryItem => ({
				id: `chat-file:${file.path}`,
				type: 'file',
				name: file.filename,
				section: 'this-chat',
				updatedAt: now,
				fileOrigin: 'uploaded',
				originChatTitle: chatTitle,
				content: { kind: 'chat-file', path: file.path, filename: file.filename },
			}),
		),
	];
}

export function describeLibraryItem(item: LibraryItem): string {
	const parts: string[] = [];
	if (item.fileOrigin) {
		parts.push(item.fileOrigin === 'uploaded' ? 'Uploaded' : 'Generated');
	}
	if (item.detail) {
		parts.push(item.detail);
	}
	if (item.sharedBy) {
		parts.push(`by ${item.sharedBy}`);
	} else if (item.section !== 'this-chat' && item.originChatTitle) {
		parts.push(`from “${item.originChatTitle}”`);
	}
	return parts.join(' · ');
}

export function toLibraryMention(item: LibraryItem): LibraryMention {
	return { id: `${LIBRARY_MENTION_PREFIX}${item.type}:${item.id}`, label: item.name };
}

export function writeLibraryDragData(dataTransfer: DataTransfer, item: LibraryItem) {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(LIBRARY_ITEM_DRAG_TYPE, JSON.stringify(toLibraryMention(item)));
	dataTransfer.setData('text/plain', item.name);
}

export function readLibraryDragData(dataTransfer: DataTransfer | null): LibraryMention | null {
	const raw = dataTransfer?.getData(LIBRARY_ITEM_DRAG_TYPE);
	if (!raw) {
		return null;
	}
	try {
		const mention = JSON.parse(raw) as Partial<LibraryMention>;
		return mention.id && mention.label ? { id: mention.id, label: mention.label } : null;
	} catch {
		return null;
	}
}

export function isLibraryDrag(dataTransfer: DataTransfer | null): boolean {
	return Boolean(dataTransfer?.types.includes(LIBRARY_ITEM_DRAG_TYPE));
}

export function describeRowCount(rowCount: number): string {
	return `${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'}`;
}

function matchesSearch(item: LibraryItem, search: string): boolean {
	return [item.name, item.originChatTitle, item.sharedBy].some((value) => value?.toLowerCase().includes(search));
}
