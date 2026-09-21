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
