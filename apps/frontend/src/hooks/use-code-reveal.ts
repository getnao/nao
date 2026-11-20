import { useEffect } from 'react';
import type { editor } from 'monaco-editor';
import type { MountedCodeEditor } from '@/components/code-selection-ask';
import type { StoryCodeLines } from '@nao/shared/types';
import type { CodeRevealRequest } from '@/stores/code-reveal';

import { useStoryRequestFollower } from '@/hooks/use-story-request-follower';
import { completeCodeReveal, useCodeRevealRequest } from '@/stores/code-reveal';
import { isStoryRequestFor, isStoryRequestFresh } from '@/stores/story-highlight';

export const CITED_LINES_HIGHLIGHT_MS = 2000;

/** Calls `onRequest` once for each code citation of the story opened, so its view can show the cited source. */
export function useCodeRevealFollower(storySlug: string | undefined, onRequest: (request: CodeRevealRequest) => void) {
	useStoryRequestFollower(useCodeRevealRequest(), storySlug, onRequest);
}

interface CitedSource {
	storySlug?: string;
	filePath?: string;
}

/** Scrolls an editor showing the cited source, a file of a custom story when `filePath` is set, to the cited lines. */
export function useRevealCitedLines(codeEditor: MountedCodeEditor | null, { storySlug, filePath }: CitedSource = {}) {
	const request = useCodeRevealRequest();

	useEffect(() => {
		if (!codeEditor || !request || request.filePath !== filePath || !isStoryRequestFor(request, storySlug)) {
			return;
		}
		completeCodeReveal(request.id);
		revealLines(codeEditor, request.lines);
	}, [codeEditor, request, storySlug, filePath]);
}

/**
 * Calls `reveal` with the lines asked for the file shown, for views that are not a code editor, like a rendered
 * Markdown document. `reveal` returns false while it cannot show them yet, to be called again once it changes.
 */
export function useFileLinesReveal(filePath: string, reveal: (lines: StoryCodeLines) => boolean) {
	const request = useCodeRevealRequest();

	useEffect(() => {
		if (!request || request.filePath !== filePath || !isStoryRequestFresh(request)) {
			return;
		}
		if (reveal(request.lines)) {
			completeCodeReveal(request.id);
		}
	}, [filePath, request, reveal]);
}

function revealLines({ editor: instance, monaco }: MountedCodeEditor, lines: CodeRevealRequest['lines']): void {
	const model = instance.getModel();
	if (!model) {
		return;
	}
	const end = Math.min(lines.end, model.getLineCount());
	const start = Math.min(lines.start, end);
	const range = new monaco.Range(start, 1, end, model.getLineMaxColumn(end));
	instance.revealRangeInCenter(range);
	const decorations: editor.IEditorDecorationsCollection = instance.createDecorationsCollection([
		{ range, options: { isWholeLine: true, className: 'cited-code-lines' } },
	]);
	window.setTimeout(() => decorations.clear(), CITED_LINES_HIGHLIGHT_MS);
}
