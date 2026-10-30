import { randomUUID } from 'node:crypto';

/**
 * Top-level folder of the virtual tree exposing the draft files of the chat's
 * custom stories, one folder per story: `/stories/<slug>/app.jsx`. A story of another chat the user
 * can edit is reached under its id instead: `/stories/<id>/app.jsx`.
 * The name is reserved like `home`: a project folder called `stories` is never exposed.
 */
export const STORIES_MOUNT = 'stories';

export type StoryMountPath =
	| { kind: 'root' }
	| { kind: 'story'; folder: string }
	| { kind: 'file'; folder: string; filePath: string };

/** True when a virtual path addresses the stories mount: `/stories` or anything below it. */
export const isStoriesPath = (virtualPath: string | undefined | null): boolean => {
	if (typeof virtualPath !== 'string') {
		return false;
	}
	const trimmed = trimSlashes(virtualPath);
	return trimmed === STORIES_MOUNT || trimmed.startsWith(`${STORIES_MOUNT}/`);
};

/** Splits a stories virtual path into its story folder and the path inside that story. */
export const parseStoriesPath = (virtualPath: string): StoryMountPath => {
	if (!isStoriesPath(virtualPath)) {
		throw new Error(`Path '${virtualPath}' is not under /${STORIES_MOUNT}`);
	}
	const inside = trimSlashes(trimSlashes(virtualPath).slice(STORIES_MOUNT.length));
	if (inside === '') {
		return { kind: 'root' };
	}
	const [folder, ...rest] = inside.split('/');
	return rest.length === 0 ? { kind: 'story', folder } : { kind: 'file', folder, filePath: rest.join('/') };
};

const STORY_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
export const STORY_SLUG_RULE = 'up to 100 letters, digits, dashes or underscores, starting with a letter or digit';

/** A custom story slug names a single folder of the mount, so it must never contain `/` or `@`. */
export const isValidStorySlug = (slug: string): boolean => {
	return STORY_SLUG.test(slug);
};

export const generateStorySlug = (title: string): string => {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || `untitled-${randomUUID().slice(0, 8)}`
	);
};

/** Virtual path of a story folder, or of a file inside it. */
export const toStoriesVirtualPath = (folder?: string, filePath?: string): string => {
	const segments = [STORIES_MOUNT, folder, filePath].filter((segment) => segment && segment !== '');
	return `/${segments.join('/')}`;
};

/** The path relative to the mount root, as matched by glob patterns: `stories/<folder>/<file>`. */
export const toStoriesMountRelativePath = (folder: string, filePath: string): string => {
	return `${STORIES_MOUNT}/${folder}/${filePath}`;
};

const trimSlashes = (value: string): string => {
	return value.trim().replace(/^\/+|\/+$/g, '');
};

const PUBLISHED_VERSION_SEGMENT = /^@v(\d+)(?:\/(.*))?$/;

export const parsePublishedVersionPath = (filePath: string): { versionNumber: number; filePath: string } | null => {
	const match = PUBLISHED_VERSION_SEGMENT.exec(filePath);
	return match ? { versionNumber: Number(match[1]), filePath: match[2] ?? '' } : null;
};
