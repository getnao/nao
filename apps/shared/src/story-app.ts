/** Bare specifiers a story may import. Everything else is rejected at build time. */
export const STORY_APP_ALLOWED_IMPORTS = [
	'react',
	'react/jsx-runtime',
	'react-dom',
	'react-dom/client',
	'recharts',
	'@nao/story-kit',
] as const;

export type StoryAppAllowedImport = (typeof STORY_APP_ALLOWED_IMPORTS)[number];

export const STORY_APP_MANIFEST_PATH = 'nao.json';

export const STORY_APP_ENTRY_CANDIDATES = ['app.jsx', 'app.tsx', 'app.js', 'app.ts'] as const;

export const MAX_STORY_BUNDLE_BYTES = 2 * 1024 * 1024;

export const isAllowedStoryImport = (specifier: string): specifier is StoryAppAllowedImport => {
	return (STORY_APP_ALLOWED_IMPORTS as readonly string[]).includes(specifier);
};

/** Module the frame's bootstrap uses to mount the app and talk to the host; stories cannot import it. */
export const STORY_HOST_MODULE = '@nao/story-host';

export const STORY_RUNTIME_PATH = '/story-runtime';

/** Bare specifier → file name (without extension) under `STORY_RUNTIME_PATH`. Every import map entry comes from here. */
export const STORY_RUNTIME_MODULES: Record<StoryAppAllowedImport | typeof STORY_HOST_MODULE, string> = {
	react: 'react',
	'react/jsx-runtime': 'react-jsx-runtime',
	'react-dom': 'react-dom',
	'react-dom/client': 'react-dom-client',
	recharts: 'recharts',
	'@nao/story-kit': 'story-kit',
	[STORY_HOST_MODULE]: 'story-host',
};

export interface StoryQueryResult {
	columns: string[];
	data: unknown[];
}

/** Frame → host. */
export type StoryFrameMessage =
	| { type: 'nao-story:ready' }
	| { type: 'nao-story:query'; requestId: string; queryId: string }
	| { type: 'nao-story:error'; message: string; stack?: string };

/** Host → frame. */
export type StoryHostMessage =
	| { type: 'nao-story:query-result'; requestId: string; result: StoryQueryResult }
	| { type: 'nao-story:query-error'; requestId: string; message: string };

export const isStoryFrameMessage = (value: unknown): value is StoryFrameMessage => {
	return isStoryMessage(value) && ['nao-story:ready', 'nao-story:query', 'nao-story:error'].includes(value.type);
};

export const isStoryHostMessage = (value: unknown): value is StoryHostMessage => {
	return isStoryMessage(value) && ['nao-story:query-result', 'nao-story:query-error'].includes(value.type);
};

const isStoryMessage = (value: unknown): value is { type: string } => {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
};
