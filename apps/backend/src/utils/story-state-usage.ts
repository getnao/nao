import { STORY_HTML_API_GLOBAL } from '@nao/shared/story-app';

const SCRIPT_FILE = /\.[jt]sx?$/i;
const LOCAL_STATE_HOOK = /\buse(?:State|Reducer)\s*[(<]/;

/** React state the story keeps only for the visit: what the agent could turn into saved state. */
export function storyHasLocalState(files: { path: string; content: string }[]): boolean {
	return files.some((file) => SCRIPT_FILE.test(file.path) && LOCAL_STATE_HOOK.test(file.content));
}

export function storyUsesState(files: { content: string }[]): boolean {
	return files.some(
		(file) => file.content.includes('useStoryState') || file.content.includes(`${STORY_HTML_API_GLOBAL}.state.`),
	);
}
