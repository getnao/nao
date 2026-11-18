import type { CustomStoryFileSummary } from '@/components/custom-story/custom-story-body';

const STORY_KIT_FOLDER = '@nao/story-kit';
const STORY_KIT_ENTRY_NAME = 'index.ts';

const entrySource = import.meta.glob<string>('../../story-runtime/story-kit.ts', { query: '?raw', import: 'default' });
const moduleSources = import.meta.glob<string>('../../story-runtime/story-kit/*.{ts,tsx}', {
	query: '?raw',
	import: 'default',
});

/** Read-only sources of the kit stories import, shown next to the story's own files under `@nao/story-kit/`. */
const loadersByPath = new Map<string, () => Promise<string>>([
	...Object.values(entrySource).map((load) => [kitPath(STORY_KIT_ENTRY_NAME), load] as const),
	...Object.entries(moduleSources).map(([source, load]) => [kitPath(fileName(source)), load] as const),
]);

export const STORY_KIT_FILE_PATHS = [...loadersByPath.keys()];

export function isStoryKitPath(path: string | null): path is string {
	return path !== null && loadersByPath.has(path);
}

export function storyKitFileQueryOptions(path: string) {
	return {
		queryKey: ['story-kit-file', path],
		queryFn: () => loadStoryKitFile(path),
		staleTime: Infinity,
	};
}

async function loadStoryKitFile(path: string): Promise<CustomStoryFileSummary & { content: string }> {
	const load = loadersByPath.get(path);
	if (!load) {
		throw new Error(`Unknown story kit file: ${path}`);
	}
	const content = await load();
	return { path, size: new TextEncoder().encode(content).length, content };
}

function kitPath(name: string): string {
	return `${STORY_KIT_FOLDER}/${name}`;
}

function fileName(source: string): string {
	return source.split('/').pop() ?? source;
}
