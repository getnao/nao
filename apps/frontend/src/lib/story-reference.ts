import type { DragEvent as ReactDragEvent } from 'react';

export const STORY_DRAG_TYPE = 'application/x-nao-story';
export const STORY_FOLDER_DRAG_TYPE = 'application/x-nao-story-folder';
export const NEW_CHAT_DROP_TARGET_ATTRIBUTE = 'data-new-chat-drop-target';

const STORY_PATH = /^\/stories\/([^/]+)\/?$/;
const STORIES_PAGE_PATH = /^\/stories\/?$/;

export function setStoryDragData(event: ReactDragEvent, { storyIds, folderIds }: StoryReferences): void {
	if (storyIds.length > 0) {
		event.dataTransfer.setData(STORY_DRAG_TYPE, storyIds.join('\n'));
	}
	if (folderIds.length > 0) {
		event.dataTransfer.setData(STORY_FOLDER_DRAG_TYPE, folderIds.join('\n'));
	}
}

export function isStoryDrag(dataTransfer: DataTransfer | null): boolean {
	return [STORY_DRAG_TYPE, STORY_FOLDER_DRAG_TYPE].some((type) => dataTransfer?.types.includes(type) ?? false);
}

/** Links are only readable on drop, so a dragged link may or may not point to a story. */
export function mayCarryStories(dataTransfer: DataTransfer | null): boolean {
	return isStoryDrag(dataTransfer) || (dataTransfer?.types.includes('text/uri-list') ?? false);
}

export type StoryReferences = { storyIds: string[]; folderIds: string[] };

export const NO_STORY_REFERENCES: StoryReferences = { storyIds: [], folderIds: [] };

/**
 * The stories and story folders a drop carries: story cards of this app, or links to stories and folders
 * dragged from the stories page or another tab. A folder references its stories, like its @-mention.
 */
export function readDroppedReferences(dataTransfer: DataTransfer | null): StoryReferences {
	if (!dataTransfer) {
		return NO_STORY_REFERENCES;
	}
	if (isStoryDrag(dataTransfer)) {
		return {
			storyIds: readIdList(dataTransfer, STORY_DRAG_TYPE),
			folderIds: readIdList(dataTransfer, STORY_FOLDER_DRAG_TYPE),
		};
	}
	const links = (dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain'))
		.split(/\r?\n/)
		.map((link) => link.trim())
		.filter((link) => link && !link.startsWith('#'));
	return {
		storyIds: unique(links.map((link) => parseStoryIdFromUrl(link)).filter(isPresent)),
		folderIds: unique(links.map((link) => parseStoryFolderIdFromUrl(link)).filter(isPresent)),
	};
}

export function hasAnyStoryReference({ storyIds, folderIds }: StoryReferences): boolean {
	return storyIds.length > 0 || folderIds.length > 0;
}

export function parseStoryIdFromUrl(value: string, origin: string = window.location.origin): string | null {
	const url = parseSameOriginUrl(value, origin);
	return url?.pathname.match(STORY_PATH)?.[1] ?? null;
}

export function parseStoryFolderIdFromUrl(value: string, origin: string = window.location.origin): string | null {
	const url = parseSameOriginUrl(value, origin);
	if (!url || !STORIES_PAGE_PATH.test(url.pathname)) {
		return null;
	}
	const folderId = url.searchParams.get('folderId');
	return folderId && folderId !== 'null' ? folderId : null;
}

export function isOverNewChatDropTarget(x: number, y: number): boolean {
	return document.elementsFromPoint(x, y).some((element) => element.closest(`[${NEW_CHAT_DROP_TARGET_ATTRIBUTE}]`));
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function readIdList(dataTransfer: DataTransfer, type: string): string[] {
	return unique(dataTransfer.getData(type).split('\n').filter(Boolean));
}

function parseSameOriginUrl(value: string, origin: string): URL | null {
	try {
		const url = new URL(value, origin);
		return url.origin === origin ? url : null;
	} catch {
		return null;
	}
}

function isPresent(value: string | null): value is string {
	return value !== null;
}
