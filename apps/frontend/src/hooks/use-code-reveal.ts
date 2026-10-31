import { useEffect } from 'react';
import type { editor } from 'monaco-editor';
import type { MountedCodeEditor } from '@/components/code-selection-ask';
import type { CodeRevealRequest } from '@/stores/code-reveal';

import { useStoryRequestFollower } from '@/hooks/use-story-request-follower';
import { completeCodeReveal, useCodeRevealRequest } from '@/stores/code-reveal';
import { isStoryRequestFor } from '@/stores/story-highlight';

const CITED_LINES_HIGHLIGHT_MS = 2000;

/** Calls `onRequest` once for each code citation of the story opened, so its view can show the cited source. */
export function useCodeRevealFollower(storySlug: string | undefined, onRequest: (request: CodeRevealRequest) => void) {
	useStoryRequestFollower(useCodeRevealRequest(), storySlug, onRequest);
}

/** Scrolls an editor showing the cited source, a file of a custom story when `filePath` is set, to the cited lines. */
export function useRevealCitedLines(codeEditor: MountedCodeEditor | null, filePath?: string) {
	const request = useCodeRevealRequest();

	useEffect(() => {
		if (!codeEditor || !request || request.filePath !== filePath || !isStoryRequestFor(request)) {
			return;
		}
		completeCodeReveal(request.id);
		revealLines(codeEditor, request.lines);
	}, [codeEditor, request, filePath]);
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
