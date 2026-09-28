import type { UserGroupFeature } from '@nao/shared';
import type { grep, list, searchFiles } from '@nao/shared/tools';
import { minimatch } from 'minimatch';
import path from 'path';

import type { DBStory, DBStoryDraftFile } from '../db/abstractSchema';
import { env } from '../env';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import {
	parsePublishedVersionPath,
	parseStoriesPath,
	STORIES_MOUNT,
	type StoryMountPath,
	toStoriesMountRelativePath,
	toStoriesVirtualPath,
} from '../utils/story-mount';

/** The files of one story (its draft, or a published version), addressed by their path inside the story. */
interface MountedStory {
	story: DBStory;
	files: MountedFile[];
}

type MountedFile = Pick<DBStoryDraftFile, 'path' | 'content'>;

interface GrepOptions {
	pattern: string;
	glob?: string;
	caseInsensitive?: boolean;
	contextLines?: number;
	maxResults: number;
}

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

export async function listStoryMount(chatId: string, virtualPath: string): Promise<list.Entry[]> {
	const target = parseStoriesPath(virtualPath);
	if (target.kind === 'root') {
		return listMountRoot(chatId);
	}

	const directory = target.kind === 'file' ? target.filePath : '';
	const mounted = parsePublishedVersionPath(directory)
		? await loadPublishedVersion(chatId, target.slug, directory)
		: await loadMountedStory(chatId, target.slug);
	const entries = entriesInDirectory(mounted, directory);
	if (entries.length === 0 && directory !== '') {
		throw new Error(`No folder '${virtualPath}' in story "${target.slug}".`);
	}
	return entries;
}

export async function readStoryMountFile(chatId: string, virtualPath: string): Promise<string> {
	const target = requireFilePath(virtualPath);
	if (parsePublishedVersionPath(target.filePath)) {
		return readPublishedVersionFile(chatId, target.slug, target.filePath, virtualPath);
	}
	const story = await requireCustomStory(chatId, target.slug);
	const file = await storyFileQueries.getDraftFile(story.id, target.filePath);
	if (!file) {
		throw new Error(
			`No file '${virtualPath}' in story "${target.slug}". Use list on /${STORIES_MOUNT}/${target.slug} to see its files.`,
		);
	}
	return file.content;
}

export async function writeStoryMountFile(
	chatId: string,
	virtualPath: string,
	content: string,
): Promise<{ path: string; size: number }> {
	const target = requireFilePath(virtualPath);
	const published = parsePublishedVersionPath(target.filePath);
	if (published) {
		throw new Error(
			`Published versions are read-only. Edit the draft at ${toStoriesVirtualPath(target.slug, published.filePath)} instead.`,
		);
	}
	const story = await requireCustomStory(chatId, target.slug);
	const file = await storyFileQueries.writeDraftFile(story.id, { path: target.filePath, content });
	return { path: toStoriesVirtualPath(target.slug, file.path), size: Buffer.byteLength(file.content, 'utf8') };
}

export async function findStoryMountFiles(
	chatId: string,
	matches: (mountRelativePath: string) => boolean,
): Promise<searchFiles.File[]> {
	const stories = await loadMountedStories(chatId);
	return stories.flatMap(({ story, files }) =>
		files
			.filter((file) => matches(toStoriesMountRelativePath(story.slug, file.path)))
			.map((file) => fileEntry(story.slug, file)),
	);
}

export async function grepStoryMount(
	chatId: string,
	virtualPath: string | undefined,
	options: GrepOptions,
): Promise<{ matches: grep.Match[]; totalMatches: number }> {
	const regex = compilePattern(options);
	const scope = virtualPath === undefined ? { kind: 'root' as const } : parseStoriesPath(virtualPath);
	const stories =
		scope.kind === 'root' ? await loadMountedStories(chatId) : [await loadMountedStory(chatId, scope.slug)];

	const matches: grep.Match[] = [];
	let totalMatches = 0;
	for (const { story, files } of stories) {
		for (const file of files) {
			if (!isInGrepScope(file, scope) || !matchesGlob(story.slug, file, options.glob)) {
				continue;
			}
			const found = grepFile(regex, file.content, options.contextLines);
			totalMatches += found.length;
			for (const match of found.slice(0, Math.max(0, options.maxResults - matches.length))) {
				matches.push({ ...match, path: toStoriesVirtualPath(story.slug, file.path) });
			}
		}
	}
	return { matches, totalMatches };
}

async function listMountRoot(chatId: string): Promise<list.Entry[]> {
	const stories = await loadMountedStories(chatId);
	return stories.map(({ story, files }) => ({
		path: toStoriesVirtualPath(story.slug),
		name: story.slug,
		type: 'directory' as const,
		itemCount: files.length,
	}));
}

/** Files directly under `directory`, plus one entry per sub-folder implied by deeper paths. */
function entriesInDirectory({ story, files }: MountedStory, directory: string): list.Entry[] {
	const prefix = directory === '' ? '' : `${directory}/`;
	const subfolders = new Map<string, number>();
	const entries: list.Entry[] = [];

	for (const file of files) {
		if (!file.path.startsWith(prefix)) {
			continue;
		}
		const rest = file.path.slice(prefix.length);
		const [head, ...deeper] = rest.split('/');
		if (deeper.length === 0) {
			entries.push({ ...fileEntry(story.slug, file), name: head, type: 'file' });
		} else {
			subfolders.set(head, (subfolders.get(head) ?? 0) + 1);
		}
	}

	const folderEntries = [...subfolders.entries()].map(([name, itemCount]) => ({
		path: toStoriesVirtualPath(story.slug, `${prefix}${name}`),
		name,
		type: 'directory' as const,
		itemCount,
	}));
	return [...folderEntries, ...entries];
}

function fileEntry(slug: string, file: MountedFile): searchFiles.File {
	const virtualPath = toStoriesVirtualPath(slug, file.path);
	return {
		path: virtualPath,
		dir: path.posix.dirname(virtualPath),
		size: String(Buffer.byteLength(file.content, 'utf8')),
	};
}

/** A published version's files, placed under their `@vN/` segment so folder listing works unchanged. */
async function loadPublishedVersion(chatId: string, slug: string, directory: string): Promise<MountedStory> {
	const story = await requireCustomStory(chatId, slug);
	const { versionNumber } = parsePublishedVersionPath(directory)!;
	const version = await requirePublishedVersion(story, versionNumber);
	const files = await storyFileQueries.listVersionFiles(version.id);
	return { story, files: files.map((file) => ({ path: `@v${versionNumber}/${file.path}`, content: file.content })) };
}

async function readPublishedVersionFile(
	chatId: string,
	slug: string,
	filePath: string,
	virtualPath: string,
): Promise<string> {
	const story = await requireCustomStory(chatId, slug);
	const published = parsePublishedVersionPath(filePath)!;
	const version = await requirePublishedVersion(story, published.versionNumber);
	const file = await storyFileQueries.getVersionFile(version.id, published.filePath);
	if (!file) {
		throw new Error(`No file '${virtualPath}' in version ${published.versionNumber} of story "${slug}".`);
	}
	return file.content;
}

async function requirePublishedVersion(story: DBStory, versionNumber: number) {
	const version = await storyQueries.getVersionByNumber(story.chatId!, story.slug, versionNumber);
	if (!version) {
		throw new Error(`Story "${story.slug}" has no published version ${versionNumber}.`);
	}
	return version;
}

async function loadMountedStories(chatId: string): Promise<MountedStory[]> {
	assertCustomStoriesEnabled();
	const stories = await storyQueries.listCustomStoriesInChat(chatId);
	return Promise.all(
		stories.map(async (story) => ({ story, files: await storyFileQueries.listDraftFiles(story.id) })),
	);
}

async function loadMountedStory(chatId: string, slug: string): Promise<MountedStory> {
	const story = await requireCustomStory(chatId, slug);
	return { story, files: await storyFileQueries.listDraftFiles(story.id) };
}

async function requireCustomStory(chatId: string, slug: string): Promise<DBStory> {
	assertCustomStoriesEnabled();
	const story = await storyQueries.getStoryByChatAndSlug(chatId, slug);
	if (!story || story.format !== 'custom') {
		throw new Error(
			`No custom story "${slug}" in this chat. Create it first with the story tool (action "create", format "custom").`,
		);
	}
	return story;
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

function compilePattern({ pattern, caseInsensitive }: GrepOptions): RegExp {
	try {
		return new RegExp(pattern, caseInsensitive ? 'i' : '');
	} catch (error) {
		throw new Error(`Invalid pattern '${pattern}': ${(error as Error).message}`);
	}
}

function isInGrepScope(file: MountedFile, scope: StoryMountPath): boolean {
	return scope.kind !== 'file' || file.path === scope.filePath || file.path.startsWith(`${scope.filePath}/`);
}

function matchesGlob(slug: string, file: MountedFile, glob: string | undefined): boolean {
	return !glob || minimatch(toStoriesMountRelativePath(slug, file.path), glob, { matchBase: true, dot: true });
}

function grepFile(regex: RegExp, content: string, contextLines: number | undefined): Omit<grep.Match, 'path'>[] {
	const lines = content.split('\n');
	const matches: Omit<grep.Match, 'path'>[] = [];
	lines.forEach((line, index) => {
		if (!regex.test(line)) {
			return;
		}
		matches.push({
			line_number: index + 1,
			line_content: line,
			...(contextLines && contextLines > 0
				? {
						context_before: lines.slice(Math.max(0, index - contextLines), index),
						context_after: lines.slice(index + 1, index + 1 + contextLines),
					}
				: {}),
		});
	});
	return matches;
}
