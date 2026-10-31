// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MountedCodeEditor } from '@/components/code-selection-ask';

import { useCodeRevealFollower, useRevealCitedLines } from '@/hooks/use-code-reveal';
import { completeCodeReveal, requestCodeReveal, useCodeRevealRequest } from '@/stores/code-reveal';

afterEach(() => {
	const { result } = renderHook(() => useCodeRevealRequest());
	if (result.current) {
		completeCodeReveal(result.current.id);
	}
	cleanup();
});

describe('code citation reveal', () => {
	it('opens the code view of the cited story only', () => {
		const onStory = vi.fn();
		const onOtherStory = vi.fn();
		renderHook(() => useCodeRevealFollower('overview', onStory));
		renderHook(() => useCodeRevealFollower('other', onOtherStory));

		act(() => requestCodeReveal(codeCitation('app.jsx')));

		expect(onStory).toHaveBeenCalledWith(
			expect.objectContaining({ filePath: 'app.jsx', lines: { start: 3, end: 5 } }),
		);
		expect(onOtherStory).not.toHaveBeenCalled();
	});

	it('scrolls the editor of the cited file to the cited lines, once', () => {
		const { codeEditor, revealRangeInCenter } = createCodeEditor();
		const request = renderHook(() => useCodeRevealRequest());
		renderHook(() => useRevealCitedLines(codeEditor, 'lib/other.js'));
		renderHook(() => useRevealCitedLines(codeEditor, 'app.jsx'));

		act(() => requestCodeReveal(codeCitation('app.jsx')));

		expect(revealRangeInCenter).toHaveBeenCalledTimes(1);
		expect(revealRangeInCenter).toHaveBeenCalledWith({ start: 3, end: 5 });
		expect(request.result.current).toBeNull();
	});
});

function codeCitation(filePath: string) {
	return {
		start: 0,
		end: 0,
		text: 'const total = 1;',
		storySlug: 'overview',
		block: { kind: 'code', title: filePath, lines: { start: 3, end: 5 } },
	};
}

function createCodeEditor() {
	const revealRangeInCenter = vi.fn();
	const model = { getLineCount: () => 10, getLineMaxColumn: () => 20 };
	const editor = {
		getModel: () => model,
		revealRangeInCenter,
		createDecorationsCollection: () => ({ clear: vi.fn() }),
	};
	class Range {
		start: number;
		end: number;
		constructor(startLine: number, _startColumn: number, endLine: number) {
			this.start = startLine;
			this.end = endLine;
		}
	}
	const codeEditor = { editor, monaco: { Range } } as unknown as MountedCodeEditor;
	return { codeEditor, revealRangeInCenter };
}
