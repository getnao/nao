// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoryCodeLines } from '@nao/shared/types';

import { useMarkdownLinesReveal } from '@/hooks/use-markdown-lines-reveal';
import { completeCodeReveal, requestFileLinesReveal, useCodeRevealRequest } from '@/stores/code-reveal';

const MARKDOWN = '# Orders\n\n- placed\n- shipped\n';

afterEach(() => {
	const { result } = renderHook(() => useCodeRevealRequest());
	if (result.current) {
		completeCodeReveal(result.current.id);
	}
	cleanup();
});

describe('useMarkdownLinesReveal', () => {
	it('highlights the list item at the lines asked, once', () => {
		const request = renderHook(() => useCodeRevealRequest());
		render(<RenderedMarkdown filePath='/docs/orders.md' />);

		act(() => requestFileLinesReveal('/docs/orders.md', { start: 7, end: 7 }));

		expect(screen.getByTestId('cited-markdown-lines')).toBeDefined();
		expect(request.result.current).toBeNull();
	});

	it('scrolls to the top without a highlight for lines of the frontmatter', () => {
		render(<RenderedMarkdown filePath='/docs/orders.md' />);
		const container = screen.getByTestId('container');
		container.scrollTop = 40;

		act(() => requestFileLinesReveal('/docs/orders.md', { start: 2, end: 2 }));

		expect(screen.queryByTestId('cited-markdown-lines')).toBeNull();
		expect(container.scrollTop).toBe(0);
	});

	it.each([
		{ case: 'highlights lines the rendering moved', renderedLine: 7, isHighlighted: true },
		{ case: 'highlights nothing for lines the rendering dropped', renderedLine: null, isHighlighted: false },
	])('$case', ({ renderedLine, isHighlighted }) => {
		const toRenderedLines = () => (renderedLine ? { start: renderedLine, end: renderedLine } : null);
		render(<RenderedMarkdown filePath='/RULES.md' toRenderedLines={toRenderedLines} />);

		act(() => requestFileLinesReveal('/RULES.md', { start: 40, end: 40 }));

		expect(screen.queryByTestId('cited-markdown-lines') !== null).toBe(isHighlighted);
	});

	it('leaves the lines asked for another file to its view', () => {
		const request = renderHook(() => useCodeRevealRequest());
		render(<RenderedMarkdown filePath='/docs/orders.md' />);

		act(() => requestFileLinesReveal('/docs/customers.md', { start: 7, end: 7 }));

		expect(screen.queryByTestId('cited-markdown-lines')).toBeNull();
		expect(request.result.current).toMatchObject({ filePath: '/docs/customers.md' });
	});
});

/** A document whose 3-line frontmatter is not rendered, so its list starts at line 6 of the file. */
function RenderedMarkdown({
	filePath,
	toRenderedLines,
}: {
	filePath: string;
	toRenderedLines?: (lines: StoryCodeLines) => StoryCodeLines | null;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const blocksRef = useRef<HTMLDivElement>(null);
	const findBlocksRoot = useCallback(() => blocksRef.current, []);
	const highlight = useMarkdownLinesReveal({
		filePath,
		markdown: MARKDOWN,
		lineOffset: 3,
		toRenderedLines,
		containerRef,
		findBlocksRoot,
	});

	return (
		<div ref={containerRef} data-testid='container'>
			{highlight}
			<div ref={blocksRef}>
				<h1>Orders</h1>
				<ul>
					<li>placed</li>
					<li>shipped</li>
				</ul>
			</div>
		</div>
	);
}
