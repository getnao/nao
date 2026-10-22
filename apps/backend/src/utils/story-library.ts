/**
 * Top-level folder of the virtual tree exposing, read-only, the stories the user can see in the project,
 * one folder per story id: `/story-library/<id>/story.md`.
 */
export const STORY_LIBRARY_MOUNT = 'story-library';

/** These names use extensions a custom story file cannot have, so they never collide with its files. */
export const STORY_METADATA_FILE = 'story.yaml';
export const STORY_QUERIES_FILE = 'queries.sql';
export const CLASSIC_STORY_FILE = 'story.md';

export const STORY_LIBRARY_READ_ONLY = `stories in /${STORY_LIBRARY_MOUNT} are read-only. To build on one, create a new story in this conversation.`;

export type StoryLibraryPath =
	| { kind: 'root' }
	| { kind: 'story'; storyId: string }
	| { kind: 'file'; storyId: string; filePath: string };

/** True when a virtual path addresses the story library: `/story-library` or anything below it. */
export const isStoryLibraryPath = (virtualPath: string | undefined | null): boolean => {
	if (typeof virtualPath !== 'string') {
		return false;
	}
	const trimmed = trimSlashes(virtualPath);
	return trimmed === STORY_LIBRARY_MOUNT || trimmed.startsWith(`${STORY_LIBRARY_MOUNT}/`);
};

/** True when a glob pattern of the search tool targets the story library. */
export const isStoryLibraryPattern = (pattern: string): boolean => {
	return pattern.split('/').includes(STORY_LIBRARY_MOUNT);
};

export const parseStoryLibraryPath = (virtualPath: string): StoryLibraryPath => {
	if (!isStoryLibraryPath(virtualPath)) {
		throw new Error(`Path '${virtualPath}' is not under /${STORY_LIBRARY_MOUNT}`);
	}
	const inside = trimSlashes(trimSlashes(virtualPath).slice(STORY_LIBRARY_MOUNT.length));
	if (inside === '') {
		return { kind: 'root' };
	}
	const [storyId, ...rest] = inside.split('/');
	return rest.length === 0 ? { kind: 'story', storyId } : { kind: 'file', storyId, filePath: rest.join('/') };
};

export const toStoryLibraryVirtualPath = (storyId?: string, filePath?: string): string => {
	const segments = [STORY_LIBRARY_MOUNT, storyId, filePath].filter(Boolean);
	return `/${segments.join('/')}`;
};

/** The path relative to the library root, as matched by glob patterns: `story-library/<id>/<file>`. */
export const toStoryLibraryRelativePath = (storyId: string, filePath: string): string => {
	return `${STORY_LIBRARY_MOUNT}/${storyId}/${filePath}`;
};

const trimSlashes = (value: string): string => {
	return value.trim().replace(/^\/+|\/+$/g, '');
};
