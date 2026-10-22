import type { list, searchFiles } from '@nao/shared/tools';
import { minimatch } from 'minimatch';
import path from 'path';

import * as storyReferenceQueries from '../queries/story-reference.queries';
import type { StoryDetails, StoryFile, StoryQuery, StorySummary } from '../types/story-reference';
import {
	CLASSIC_STORY_FILE,
	parseStoryLibraryPath,
	STORY_LIBRARY_MOUNT,
	STORY_METADATA_FILE,
	STORY_QUERIES_FILE,
	type StoryLibraryPath,
	toStoryLibraryRelativePath,
	toStoryLibraryVirtualPath,
} from '../utils/story-library';
import { entriesInVirtualDirectory } from '../utils/virtual-directory';
import { loadStoriesDetails, loadStoryDetails, type StoryReferenceScope, toStorySummary } from './story-reference';

/** A story of the library, with the files its folder exposes. */
interface LibraryStory {
	id: string;
	files: StoryFile[];
}

/** The root lists the stories most trusted first, each described by its title and trust signals. */
export async function listStoryLibrary(scope: StoryReferenceScope, virtualPath: string): Promise<list.Entry[]> {
	const target = parseStoryLibraryPath(virtualPath);
	if (target.kind === 'root') {
		return listLibraryRoot(scope);
	}
	const story = await loadLibraryStory(scope, target.storyId);
	const directory = target.kind === 'file' ? target.filePath : '';
	const entries = entriesInVirtualDirectory(story.files, directory, (filePath) =>
		toStoryLibraryVirtualPath(story.id, filePath),
	);
	if (entries.length === 0 && directory !== '') {
		throw new Error(`No folder '${virtualPath}' in story "${story.id}".`);
	}
	return entries;
}

export async function readStoryLibraryFile(scope: StoryReferenceScope, virtualPath: string): Promise<string> {
	const target = parseStoryLibraryPath(virtualPath);
	if (target.kind !== 'file') {
		throw new Error(
			`'${virtualPath}' is a folder, not a file. Use list on it to see what it contains, then read a file inside.`,
		);
	}
	const story = await loadLibraryStory(scope, target.storyId);
	const file = story.files.find((storyFile) => storyFile.path === target.filePath);
	if (!file) {
		throw new Error(
			`No file '${virtualPath}' in story "${story.id}". Use list on ${toStoryLibraryVirtualPath(story.id)} to see its files.`,
		);
	}
	return file.content;
}

/** Files a grep over `virtualPath` covers, addressed by their virtual path. */
export async function listStoryLibraryFilesToGrep(
	scope: StoryReferenceScope,
	virtualPath: string,
	glob: string | undefined,
): Promise<{ virtualPath: string; content: string }[]> {
	const target = parseStoryLibraryPath(virtualPath);
	const stories =
		target.kind === 'root' ? await loadAllLibraryStories(scope) : [await loadLibraryStory(scope, target.storyId)];
	return stories.flatMap((story) =>
		story.files
			.filter((file) => isInGrepScope(file, target) && matchesGlob(story.id, file, glob))
			.map((file) => ({ virtualPath: toStoryLibraryVirtualPath(story.id, file.path), content: file.content })),
	);
}

export async function findStoryLibraryFiles(
	scope: StoryReferenceScope,
	matches: (libraryRelativePath: string) => boolean,
): Promise<searchFiles.File[]> {
	const stories = await loadAllLibraryStories(scope);
	return stories.flatMap((story) =>
		story.files
			.filter((file) => matches(toStoryLibraryRelativePath(story.id, file.path)))
			.map((file) => {
				const virtualPath = toStoryLibraryVirtualPath(story.id, file.path);
				return {
					path: virtualPath,
					dir: path.posix.dirname(virtualPath),
					size: String(Buffer.byteLength(file.content, 'utf8')),
				};
			}),
	);
}

async function listLibraryRoot(scope: StoryReferenceScope): Promise<list.Entry[]> {
	const stories = await listLibraryStories(scope);
	return stories.map((story) => ({
		path: toStoryLibraryVirtualPath(story.storyId),
		name: story.storyId,
		type: 'directory' as const,
		description: describeStory(toStorySummary(story)),
	}));
}

async function loadAllLibraryStories(scope: StoryReferenceScope): Promise<LibraryStory[]> {
	const details = await loadStoriesDetails(await listLibraryStories(scope));
	return details.map(toLibraryStory);
}

function listLibraryStories(scope: StoryReferenceScope): Promise<storyReferenceQueries.ReferenceableStory[]> {
	return storyReferenceQueries.listReferenceableStories(scope.userId, scope.projectId, {
		limit: storyReferenceQueries.MAX_REFERENCEABLE_STORIES_LIMIT,
	});
}

async function loadLibraryStory(scope: StoryReferenceScope, storyId: string): Promise<LibraryStory> {
	const story = await storyReferenceQueries.getReferenceableStory(scope.userId, scope.projectId, storyId);
	if (!story) {
		throw new Error(
			`No story "${storyId}" in /${STORY_LIBRARY_MOUNT}: it does not exist, is archived, or is not shared with the user. Use list on /${STORY_LIBRARY_MOUNT} to see the stories you can read.`,
		);
	}
	return toLibraryStory(await loadStoryDetails(story));
}

function toLibraryStory(story: StoryDetails): LibraryStory {
	const contentFiles = story.format === 'custom' ? story.files : [{ path: CLASSIC_STORY_FILE, content: story.code }];
	const queriesFiles =
		story.queries.length > 0 ? [{ path: STORY_QUERIES_FILE, content: renderQueries(story.queries) }] : [];
	return {
		id: story.id,
		files: [{ path: STORY_METADATA_FILE, content: renderMetadata(story) }, ...contentFiles, ...queriesFiles],
	};
}

/** String values are JSON-encoded, which YAML reads as double-quoted scalars. */
function renderMetadata(story: StoryDetails): string {
	const fields: [string, unknown][] = [
		['id', story.id],
		['title', story.title],
		['author', story.author],
		['format', story.format],
		['pinned', story.pinned],
		['certified', story.certified],
		['version', story.version],
		['updated_at', story.updatedAt],
	];
	return fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n';
}

function renderQueries(queries: StoryQuery[]): string {
	return queries.map(renderQuery).join('\n\n') + '\n';
}

function renderQuery(query: StoryQuery): string {
	const header = [`-- query_id: ${query.queryId}`, query.databaseId ? `-- database_id: ${query.databaseId}` : null];
	return [...header.filter(Boolean), query.sql.trim()].join('\n');
}

function describeStory(story: StorySummary): string {
	const details = [
		story.pinned ? 'pinned' : null,
		story.certified ? 'certified' : null,
		story.format === 'custom' ? 'custom story' : null,
		story.author ? `by ${story.author}` : null,
		`updated ${story.updatedAt.slice(0, 10)}`,
	].filter(Boolean);
	return `${JSON.stringify(story.title)} — ${details.join(', ')}`;
}

function isInGrepScope(file: StoryFile, target: StoryLibraryPath): boolean {
	return target.kind !== 'file' || file.path === target.filePath || file.path.startsWith(`${target.filePath}/`);
}

function matchesGlob(storyId: string, file: StoryFile, glob: string | undefined): boolean {
	if (!glob) {
		return true;
	}
	const options = { matchBase: true, dot: true };
	return (
		minimatch(toStoryLibraryRelativePath(storyId, file.path), glob, options) || minimatch(file.path, glob, options)
	);
}
