import { useCallback, useEffect, useState } from 'react';
import type { StoryCodeLines } from '@nao/shared/types';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { MarkdownLinesTarget } from '@/lib/markdown-blocks';

import { CITED_LINES_HIGHLIGHT_MS, useFileLinesReveal } from '@/hooks/use-code-reveal';
import { findMarkdownLinesTargets } from '@/lib/markdown-blocks';

interface MarkdownLinesRevealOptions {
	filePath: string;
	markdown: string;
	/** The lines of the file before the Markdown rendered, like its frontmatter. */
	lineOffset: number;
	/** The lines of the rendered content showing lines of the file, when rendering moves them, or null for none. */
	toRenderedLines?: (lines: StoryCodeLines) => StoryCodeLines | null;
	/** The positioned element scrolling the document, which the highlight is drawn in. */
	containerRef: RefObject<HTMLElement | null>;
	/** The element whose children are the rendered blocks, or null while they are not rendered yet. */
	findBlocksRoot: () => Element | null;
}

interface HighlightBox {
	top: number;
	left: number;
	width: number;
	height: number;
}

const HIGHLIGHT_PADDING_PX = 4;

/**
 * Scrolls a rendered Markdown document to the lines of its source asked for the file, and highlights for a moment
 * the blocks, list items or table rows showing them. Returns the highlight, to render in the container.
 */
export function useMarkdownLinesReveal({
	filePath,
	markdown,
	lineOffset,
	toRenderedLines,
	containerRef,
	findBlocksRoot,
}: MarkdownLinesRevealOptions): ReactNode {
	const [highlight, setHighlight] = useState<{ id: number; box: HighlightBox } | null>(null);

	const reveal = useCallback(
		(lines: StoryCodeLines) => {
			const container = containerRef.current;
			const blocksRoot = findBlocksRoot();
			if (!container || !blocksRoot) {
				return false;
			}
			const renderedLines = toRenderedLines ? toRenderedLines(lines) : lines;
			const targets = renderedLines
				? findMarkdownLinesTargets(markdown, {
						start: renderedLines.start - lineOffset,
						end: renderedLines.end - lineOffset,
					})
				: [];
			const elements = findTargetElements(blocksRoot, targets);
			const box = elements.length > 0 ? measureBox(container, elements) : null;
			container.scrollTop = box ? Math.max(0, box.top - (container.clientHeight - box.height) / 2) : 0;
			setHighlight(box && { id: Date.now(), box });
			return true;
		},
		[containerRef, findBlocksRoot, lineOffset, markdown, toRenderedLines],
	);

	useFileLinesReveal(filePath, reveal);

	useEffect(() => {
		if (!highlight) {
			return;
		}
		const timeout = window.setTimeout(() => setHighlight(null), CITED_LINES_HIGHLIGHT_MS);
		return () => window.clearTimeout(timeout);
	}, [highlight]);

	if (!highlight) {
		return null;
	}
	return (
		<div
			key={highlight.id}
			aria-hidden
			data-testid='cited-markdown-lines'
			className='cited-markdown-lines pointer-events-none absolute rounded-md'
			style={highlight.box satisfies CSSProperties}
		/>
	);
}

function findTargetElements(blocksRoot: Element, targets: MarkdownLinesTarget[]): Element[] {
	return targets.flatMap(({ blockIndex, rows }) => {
		const block = blocksRoot.children[blockIndex];
		if (!block) {
			return [];
		}
		if (!rows) {
			return [block];
		}
		const rowElements = block.querySelectorAll(block.matches('ul, ol') ? ':scope > li' : 'tr');
		const found = rows.flatMap((row) => rowElements[row] ?? []);
		return found.length > 0 ? found : [block];
	});
}

/** The box around the elements, in the coordinates of the scrolled content of the container. */
function measureBox(container: HTMLElement, elements: Element[]): HighlightBox {
	const containerRect = container.getBoundingClientRect();
	const rects = elements.map((element) => element.getBoundingClientRect());
	const top = Math.min(...rects.map((rect) => rect.top));
	const bottom = Math.max(...rects.map((rect) => rect.bottom));
	const left = Math.min(...rects.map((rect) => rect.left));
	const right = Math.max(...rects.map((rect) => rect.right));
	return {
		top: top - containerRect.top + container.scrollTop - HIGHLIGHT_PADDING_PX,
		left: left - containerRect.left + container.scrollLeft - HIGHLIGHT_PADDING_PX,
		width: right - left + 2 * HIGHLIGHT_PADDING_PX,
		height: bottom - top + 2 * HIGHLIGHT_PADDING_PX,
	};
}
