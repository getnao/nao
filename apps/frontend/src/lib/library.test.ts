import { describe, expect, it } from 'vitest';
import {
	LIBRARY_ITEM_DRAG_TYPE,
	countLibraryItemsByType,
	filterLibraryItems,
	groupLibraryItemsBySection,
	readLibraryDragData,
	toLibraryMention,
	writeLibraryDragData,
} from './library';
import type { LibraryItem } from './library';

function item(overrides: Partial<LibraryItem> & Pick<LibraryItem, 'id' | 'type' | 'name' | 'section'>): LibraryItem {
	return { updatedAt: 0, content: { kind: 'mock-chat', messages: [] }, ...overrides };
}

function fakeDataTransfer(): DataTransfer {
	const data = new Map<string, string>();
	return {
		effectAllowed: 'none',
		get types() {
			return [...data.keys()];
		},
		setData: (format: string, value: string) => data.set(format, value),
		getData: (format: string) => data.get(format) ?? '',
	} as unknown as DataTransfer;
}

const items = [
	item({ id: 'story-1', type: 'story', name: 'Q3 revenue review', section: 'this-chat' }),
	item({
		id: 'query-1',
		type: 'query',
		name: 'Weekly active users',
		section: 'mine',
		originChatTitle: 'Monday KPIs',
	}),
	item({ id: 'story-2', type: 'story', name: 'Attribution', section: 'shared', sharedBy: 'Marie Dupont' }),
	item({ id: 'chat-1', type: 'chat', name: 'Pricing experiment', section: 'shared', sharedBy: 'Thomas Martin' }),
];

describe('filterLibraryItems', () => {
	it('keeps every item without filters', () => {
		expect(filterLibraryItems(items, { search: '', type: 'all' })).toHaveLength(4);
	});

	it('filters by type', () => {
		expect(filterLibraryItems(items, { search: '', type: 'story' }).map((i) => i.id)).toEqual([
			'story-1',
			'story-2',
		]);
	});

	it('searches names, origin chats and owners case-insensitively', () => {
		expect(filterLibraryItems(items, { search: 'REVENUE', type: 'all' }).map((i) => i.id)).toEqual(['story-1']);
		expect(filterLibraryItems(items, { search: 'monday', type: 'all' }).map((i) => i.id)).toEqual(['query-1']);
		expect(filterLibraryItems(items, { search: 'marie', type: 'all' }).map((i) => i.id)).toEqual(['story-2']);
	});

	it('combines type and search', () => {
		expect(filterLibraryItems(items, { search: 'thomas', type: 'story' })).toEqual([]);
	});
});

describe('groupLibraryItemsBySection', () => {
	it('places each item in its section', () => {
		const groups = groupLibraryItemsBySection(items);
		expect(groups['this-chat'].map((i) => i.id)).toEqual(['story-1']);
		expect(groups.mine.map((i) => i.id)).toEqual(['query-1']);
		expect(groups.shared.map((i) => i.id)).toEqual(['story-2', 'chat-1']);
	});
});

describe('countLibraryItemsByType', () => {
	it('counts items per type and in total', () => {
		expect(countLibraryItemsByType(items)).toEqual({ all: 4, story: 2, query: 1, file: 0, chat: 1 });
	});
});

describe('library drag data', () => {
	it('round-trips an item as a mention', () => {
		const dataTransfer = fakeDataTransfer();
		writeLibraryDragData(dataTransfer, items[0]);
		expect(readLibraryDragData(dataTransfer)).toEqual(toLibraryMention(items[0]));
	});

	it('ignores drags that are not library items', () => {
		const dataTransfer = fakeDataTransfer();
		dataTransfer.setData(LIBRARY_ITEM_DRAG_TYPE, 'not json');
		expect(readLibraryDragData(dataTransfer)).toBeNull();
		expect(readLibraryDragData(null)).toBeNull();
	});
});
