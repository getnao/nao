import type { UserGroupFeature } from '@nao/shared';
import type { list, searchFiles } from '@nao/shared/tools';
import { minimatch } from 'minimatch';
import path from 'path';

import type { DBStory, DBStoryDraftFile } from '../db/abstractSchema';
import { env } from '../env';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import type { LinkedStory } from '../types/tools';
import { formatStoryFile } from '../utils/story-file-format';
import {
	parsePublishedVersionPath,
	parseStoriesPath,
	STORIES_MOUNT,
	type StoryMountPath,
	toStoriesMountRelativePath,
	toStoriesVirtualPath,
} from '../utils/story-mount';
import { entriesInVirtualDirectory } from '../utils/virtual-directory';
import { type EditableStoryScope, findEditableStory } from './editable-story';

/**
 * The chat whose custom stories are mounted, the story a quick question is about, if any, and the user whose
 * editable stories of other chats are mounted by their id.
 */
export type StoryMountScope = EditableStoryScope;

/** The files of one story (its draft, or a published version), under the folder it was reached by. */
interface MountedStory {
	folder: string;
	files: MountedFile[];
}

type MountedFile = Pick<DBStoryDraftFile, 'path' | 'content'>;

export const isCustomStoriesEnabled = (): boolean => {
	return env.BETA_CUSTOM_STORIES_ENABLED;
};

/** Why the user cannot author custom story source, or null when they can. */
export function customStoryAuthoringError(userGroupFeatures: UserGroupFeature[]): string | null {
	if (!isCustomStoriesEnabled()) {
		return 'Custom stories are disabled on this instance.';
	}
	if (!userGroupFeatures.includes('customStoryCreation')) {
		return 'Custom story authoring is unavailable for this user in this project.';
	}
	return null;
}

export async function listStoryMount(scope: StoryMountScope, virtualPath: string): Promise<list.Entry[]> {
	const target = parseStoriesPath(virtualPath);
	if (target.kind === 'root') {
		return listMountRoot(scope);
	}

	const directory = target.kind === 'file' ? target.filePath : '';
	const mounted = parsePublishedVersionPath(directory)
		? await loadPublishedVersion(scope, target.folder, directory)
		: await loadMountedStory(scope, target.folder);
	const entries = entriesInDirectory(mounted, directory);
	if (entries.length === 0 && directory !== '') {
		throw new Error(`No folder '${virtualPath}' in story "${target.folder}".`);
	}
	return entries;
}

export async function readStoryMountFile(scope: StoryMountScope, virtualPath: string): Promise<string> {
	const target = requireFilePath(virtualPath);
	if (parsePublishedVersionPath(target.filePath)) {
		return readPublishedVersionFile(scope, target.folder, target.filePath, virtualPath);
	}
	const story = await requireCustomStory(scope, target.folder);
	const file = await storyFileQueries.getDraftFile(story.id, target.filePath);
	if (!file) {
		throw new Error(
			`No file '${virtualPath}' in story "${target.folder}". Use list on /${STORIES_MOUNT}/${target.folder} to see its files.`,
		);
	}
	return file.content;
}

export async function writeStoryMountFile(
	scope: StoryMountScope,
	virtualPath: string,
	content: string,
): Promise<{ path: string; size: number }> {
	const target = requireFilePath(virtualPath);
	const published = parsePublishedVersionPath(target.filePath);
	if (published) {
		throw new Error(
			`Published versions are read-only. Edit the draft at ${toStoriesVirtualPath(target.folder, published.filePath)} instead.`,
		);
	}
	const story = await requireCustomStory(scope, target.folder);
	const file = await storyFileQueries.writeDraftFile(story.id, {
		path: target.filePath,
		content: await formatStoryFile(target.filePath, content),
	});
	return { path: toStoriesVirtualPath(target.folder, file.path), size: Buffer.byteLength(file.content, 'utf8') };
}

/** The same file gets the same key from any chat, whichever folder it is reached by, so concurrent edits queue up. */
export async function storyMountFileLockKey(scope: StoryMountScope, virtualPath: string): Promise<string> {
	const target = requireFilePath(virtualPath);
	const story = await requireCustomStory(scope, target.folder);
	return `${story.id}:${target.filePath}`;
}

export async function findStoryMountFiles(
	scope: StoryMountScope,
	matches: (mountRelativePath: string) => boolean,
): Promise<searchFiles.File[]> {
	const stories = await loadMountedStories(scope);
	return stories.flatMap(({ folder, files }) =>
		files
			.filter((file) => matches(toStoriesMountRelativePath(folder, file.path)))
			.map((file) => fileEntry(folder, file)),
	);
}

/** Draft files a grep over `virtualPath` covers, addressed by their virtual path. */
export async function listStoryMountFilesToGrep(
	mountScope: StoryMountScope,
	virtualPath: string | undefined,
	glob: string | undefined,
): Promise<{ virtualPath: string; content: string }[]> {
	const scope = virtualPath === undefined ? { kind: 'root' as const } : parseStoriesPath(virtualPath);
	const stories = await loadGrepScope(mountScope, scope);
	return stories.flatMap(({ folder, files }) =>
		files
			.filter((file) => isInGrepScope(file, scope) && matchesGlob(folder, file, glob))
			.map((file) => ({ virtualPath: toStoriesVirtualPath(folder, file.path), content: file.content })),
	);
}

/** A scope under `@vN/` searches that published version; any other scope searches the drafts. */
async function loadGrepScope(mountScope: StoryMountScope, scope: StoryMountPath): Promise<MountedStory[]> {
	if (scope.kind === 'root') {
		return loadMountedStories(mountScope);
	}
	if (scope.kind === 'file' && parsePublishedVersionPath(scope.filePath)) {
		return [await loadPublishedVersion(mountScope, scope.folder, scope.filePath)];
	}
	return [await loadMountedStory(mountScope, scope.folder)];
}

async function listMountRoot(scope: StoryMountScope): Promise<list.Entry[]> {
	const stories = await loadMountedStories(scope);
	return stories.map(({ folder, files }) => ({
		path: toStoriesVirtualPath(folder),
		name: folder,
		type: 'directory' as const,
		itemCount: files.length,
	}));
}

function entriesInDirectory({ folder, files }: MountedStory, directory: string): list.Entry[] {
	return entriesInVirtualDirectory(files, directory, (filePath) => toStoriesVirtualPath(folder, filePath));
}

function fileEntry(folder: string, file: MountedFile): searchFiles.File {
	const virtualPath = toStoriesVirtualPath(folder, file.path);
	return {
		path: virtualPath,
		dir: path.posix.dirname(virtualPath),
		size: String(Buffer.byteLength(file.content, 'utf8')),
	};
}

/** A published version's files, placed under their `@vN/` segment so folder listing works unchanged. */
async function loadPublishedVersion(scope: StoryMountScope, folder: string, directory: string): Promise<MountedStory> {
	const story = await requireCustomStory(scope, folder);
	const { versionNumber } = parsePublishedVersionPath(directory)!;
	const version = await requirePublishedVersion(story, versionNumber);
	const files = await storyFileQueries.listVersionFiles(version.id);
	return { folder, files: files.map((file) => ({ path: `@v${versionNumber}/${file.path}`, content: file.content })) };
}

async function readPublishedVersionFile(
	scope: StoryMountScope,
	folder: string,
	filePath: string,
	virtualPath: string,
): Promise<string> {
	const story = await requireCustomStory(scope, folder);
	const published = parsePublishedVersionPath(filePath)!;
	const version = await requirePublishedVersion(story, published.versionNumber);
	const file = await storyFileQueries.getVersionFile(version.id, published.filePath);
	if (!file) {
		throw new Error(`No file '${virtualPath}' in version ${published.versionNumber} of story "${folder}".`);
	}
	return file.content;
}

async function requirePublishedVersion(story: DBStory, versionNumber: number) {
	const version = await storyQueries.getVersionByStoryIdAndNumber(story.id, versionNumber);
	if (!version) {
		throw new Error(`Story "${story.slug}" has no published version ${versionNumber}.`);
	}
	return version;
}

/** The custom stories of the chat, plus the one a quick question is about when its owner asks. */
async function loadMountedStories(scope: StoryMountScope): Promise<MountedStory[]> {
	assertCustomStoriesEnabled();
	const linkedStory = await findEditableLinkedStory(scope);
	const ownStories = await storyQueries.listCustomStoriesInChat(scope.chatId);
	const stories = linkedStory
		? [...ownStories.filter((story) => story.slug !== linkedStory.slug), linkedStory]
		: ownStories;
	return Promise.all(
		stories.map(async (story) => ({ folder: story.slug, files: await storyFileQueries.listDraftFiles(story.id) })),
	);
}

async function loadMountedStory(scope: StoryMountScope, folder: string): Promise<MountedStory> {
	const story = await requireCustomStory(scope, folder);
	return { folder, files: await storyFileQueries.listDraftFiles(story.id) };
}

async function requireCustomStory(scope: StoryMountScope, folder: string): Promise<DBStory> {
	assertCustomStoriesEnabled();
	const found = await findEditableStory(scope, folder);
	if ('error' in found) {
		throw new Error(found.error);
	}
	if (found.story.format !== 'custom') {
		throw new Error(`Story "${folder}" is not a custom story: it has no files under /${STORIES_MOUNT}.`);
	}
	return found.story;
}

async function findEditableLinkedStory(scope: StoryMountScope): Promise<DBStory | null> {
	const linkedStory = editableLinkedStory(scope);
	return linkedStory ? storyQueries.getStoryByChatAndSlug(linkedStory.chatId, linkedStory.slug) : null;
}

function editableLinkedStory({ linkedStory }: StoryMountScope): LinkedStory | undefined {
	return linkedStory?.canEdit && linkedStory.format === 'custom' ? linkedStory : undefined;
}

function assertCustomStoriesEnabled(): void {
	if (!isCustomStoriesEnabled()) {
		throw new Error(`/${STORIES_MOUNT} is not available: custom stories are disabled on this instance.`);
	}
}

function requireFilePath(virtualPath: string): Extract<StoryMountPath, { kind: 'file' }> {
	const target = parseStoriesPath(virtualPath);
	if (target.kind !== 'file') {
		throw new Error(`'${virtualPath}' is a folder, not a file. Files live at /${STORIES_MOUNT}/<story>/<path>.`);
	}
	return target;
}

function isInGrepScope(file: MountedFile, scope: StoryMountPath): boolean {
	return scope.kind !== 'file' || file.path === scope.filePath || file.path.startsWith(`${scope.filePath}/`);
}

function matchesGlob(folder: string, file: MountedFile, glob: string | undefined): boolean {
	if (!glob) {
		return true;
	}
	const options = { matchBase: true, dot: true };
	return (
		minimatch(toStoriesMountRelativePath(folder, file.path), glob, options) || minimatch(file.path, glob, options)
	);
}
