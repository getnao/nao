/**
 * Top-level folder of the virtual tree exposing the draft files of the chat's
 * custom stories, one folder per story slug: `/stories/<slug>/app.jsx`.
 * The name is reserved like `home`: a project folder called `stories` is never exposed.
 */
export const STORIES_MOUNT = 'stories';

export type StoryMountPath =
	| { kind: 'root' }
	| { kind: 'story'; slug: string }
	| { kind: 'file'; slug: string; filePath: string };

/** True when a virtual path addresses the stories mount: `/stories` or anything below it. */
export const isStoriesPath = (virtualPath: string | undefined | null): boolean => {
	if (typeof virtualPath !== 'string') {
		return false;
	}
	const trimmed = trimSlashes(virtualPath);
	return trimmed === STORIES_MOUNT || trimmed.startsWith(`${STORIES_MOUNT}/`);
};

/** Splits a stories virtual path into its story slug and the path inside that story. */
export const parseStoriesPath = (virtualPath: string): StoryMountPath => {
	if (!isStoriesPath(virtualPath)) {
		throw new Error(`Path '${virtualPath}' is not under /${STORIES_MOUNT}`);
	}
	const inside = trimSlashes(trimSlashes(virtualPath).slice(STORIES_MOUNT.length));
	if (inside === '') {
		return { kind: 'root' };
	}
	const [slug, ...rest] = inside.split('/');
	return rest.length === 0 ? { kind: 'story', slug } : { kind: 'file', slug, filePath: rest.join('/') };
};

/** Virtual path of a story folder, or of a file inside it. */
export const toStoriesVirtualPath = (slug?: string, filePath?: string): string => {
	const segments = [STORIES_MOUNT, slug, filePath].filter((segment) => segment && segment !== '');
	return `/${segments.join('/')}`;
};

/** The path relative to the mount root, as matched by glob patterns: `stories/<slug>/<file>`. */
export const toStoriesMountRelativePath = (slug: string, filePath: string): string => {
	return `${STORIES_MOUNT}/${slug}/${filePath}`;
};

const trimSlashes = (value: string): string => {
	return value.trim().replace(/^\/+|\/+$/g, '');
};

const PUBLISHED_VERSION_SEGMENT = /^@v(\d+)(?:\/(.*))?$/;

export const parsePublishedVersionPath = (filePath: string): { versionNumber: number; filePath: string } | null => {
	const match = PUBLISHED_VERSION_SEGMENT.exec(filePath);
	return match ? { versionNumber: Number(match[1]), filePath: match[2] ?? '' } : null;
};
