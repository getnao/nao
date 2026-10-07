import { STORY_APP_MANIFEST_PATH, STORY_HTML_API_GLOBAL } from '@nao/shared/story-app';

export interface StoryManifest {
	entry?: string;
	autoSave?: boolean;
}

export function parseStoryManifest(content: string | undefined): { manifest: StoryManifest; error?: string } {
	if (content === undefined) {
		return { manifest: {} };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		return { manifest: {}, error: `${STORY_APP_MANIFEST_PATH} is not valid JSON: ${(error as Error).message}` };
	}
	const { entry, autoSave } = typeof parsed === 'object' && parsed !== null ? (parsed as StoryManifest) : {};
	if (entry !== undefined && typeof entry !== 'string') {
		return {
			manifest: {},
			error: `${STORY_APP_MANIFEST_PATH}: "entry" must be a string path relative to the story root.`,
		};
	}
	if (autoSave !== undefined && typeof autoSave !== 'boolean') {
		return { manifest: {}, error: `${STORY_APP_MANIFEST_PATH}: "autoSave" must be true or false.` };
	}
	return { manifest: { entry, autoSave } };
}

export function storyUsesState(files: { content: string }[]): boolean {
	return files.some(
		(file) => file.content.includes('useStoryState') || file.content.includes(`${STORY_HTML_API_GLOBAL}.state.`),
	);
}
