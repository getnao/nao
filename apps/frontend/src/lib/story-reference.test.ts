import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	isStoryDrag,
	mayCarryStories,
	parseStoryFolderIdFromUrl,
	parseStoryIdFromUrl,
	readDroppedReferences,
	STORY_DRAG_TYPE,
	STORY_FOLDER_DRAG_TYPE,
} from './story-reference';

const ORIGIN = 'https://nao.example.com';

describe('parseStoryIdFromUrl', () => {
	it.each([
		[`${ORIGIN}/stories/abc`, 'abc'],
		[`${ORIGIN}/stories/abc/`, 'abc'],
		['/stories/abc', 'abc'],
		[`${ORIGIN}/stories/abc/edit`, null],
		[`${ORIGIN}/chats/abc`, null],
		['https://elsewhere.example.com/stories/abc', null],
		['not a url at all', null],
	])('parses %s', (url, expected) => {
		expect(parseStoryIdFromUrl(url, ORIGIN)).toBe(expected);
	});
});

describe('parseStoryFolderIdFromUrl', () => {
	it.each([
		[`${ORIGIN}/stories?folderId=finance`, 'finance'],
		['/stories/?folderId=__shared_with_me__', '__shared_with_me__'],
		[`${ORIGIN}/stories?folderId=null`, null],
		[`${ORIGIN}/stories`, null],
		[`${ORIGIN}/chats?folderId=finance`, null],
		['https://elsewhere.example.com/stories?folderId=finance', null],
	])('parses %s', (url, expected) => {
		expect(parseStoryFolderIdFromUrl(url, ORIGIN)).toBe(expected);
	});
});

describe('dropping stories', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { location: { origin: ORIGIN } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads the stories and folders dragged in the app, ignoring their links', () => {
		const dataTransfer = fakeDataTransfer({
			[STORY_DRAG_TYPE]: 'abc\ndef\nabc',
			[STORY_FOLDER_DRAG_TYPE]: 'finance\nmarketing',
			'text/uri-list': `${ORIGIN}/stories/x`,
		});

		expect(isStoryDrag(dataTransfer)).toBe(true);
		expect(readDroppedReferences(dataTransfer)).toEqual({
			storyIds: ['abc', 'def'],
			folderIds: ['finance', 'marketing'],
		});
	});

	it('reads the story and folder links dragged from another tab', () => {
		const dataTransfer = fakeDataTransfer({
			'text/uri-list': `# comment\nhttps://elsewhere.example.com/stories/nope\n${ORIGIN}/stories/xyz\n${ORIGIN}/stories?folderId=finance`,
		});

		expect(isStoryDrag(dataTransfer)).toBe(false);
		expect(mayCarryStories(dataTransfer)).toBe(true);
		expect(readDroppedReferences(dataTransfer)).toEqual({ storyIds: ['xyz'], folderIds: ['finance'] });
	});

	it('ignores drops that carry no story', () => {
		expect(mayCarryStories(fakeDataTransfer({ 'text/plain': 'hello' }))).toBe(false);
		expect(readDroppedReferences(fakeDataTransfer({ 'text/plain': 'hello' }))).toEqual({
			storyIds: [],
			folderIds: [],
		});
		expect(readDroppedReferences(null)).toEqual({ storyIds: [], folderIds: [] });
	});
});

function fakeDataTransfer(data: Record<string, string>): DataTransfer {
	return { types: Object.keys(data), getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
}
