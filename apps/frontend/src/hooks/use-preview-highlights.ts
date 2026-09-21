import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface HighlightRegistry {
	delete: (name: string) => boolean;
	set: (name: string, highlight: unknown) => void;
}

interface PreviewHighlightOptions {
	containerRef: RefObject<HTMLElement | null>;
	content: string;
	filePath: string;
	searchQuery: string;
}

declare const Highlight: new (...ranges: Range[]) => unknown;

const HIGHLIGHT_NAME = 'nao-file-preview-search-match';
const MAX_HIGHLIGHT_RANGES = 2_000;

export function usePreviewHighlights({ containerRef, content, filePath, searchQuery }: PreviewHighlightOptions): void {
	const revealKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const registry = getHighlightRegistry();
		const container = containerRef.current;
		if (!registry || !container) {
			return;
		}

		const revealKey = `${filePath}\0${searchQuery}`;
		const shouldRevealFirstMatch = revealKeyRef.current !== revealKey;
		revealKeyRef.current = revealKey;
		registry.delete(HIGHLIGHT_NAME);
		if (searchQuery.length < 2) {
			return;
		}

		const ranges = findTextRanges(container, searchQuery);
		if (ranges.length === 0) {
			return;
		}

		registry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
		if (shouldRevealFirstMatch) {
			scrollRangeIntoContainer(container, ranges[0]);
		}

		return () => {
			registry.delete(HIGHLIGHT_NAME);
		};
	}, [containerRef, content, filePath, searchQuery]);
}

function scrollRangeIntoContainer(container: HTMLElement, range: Range): void {
	const matchElement = range.startContainer.parentElement;
	if (!matchElement) {
		return;
	}
	const containerRect = container.getBoundingClientRect();
	const rangeRect = range.getBoundingClientRect();
	const matchRect =
		rangeRect.width === 0 && rangeRect.height === 0 ? matchElement.getBoundingClientRect() : rangeRect;
	const centeredOffset = matchRect.top - containerRect.top - (container.clientHeight - matchRect.height) / 2;
	container.scrollTop = Math.max(0, container.scrollTop + centeredOffset);
}

function findTextRanges(container: HTMLElement, searchQuery: string): Range[] {
	const ranges: Range[] = [];
	const normalizedQuery = searchQuery.toLowerCase();
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let textNode = walker.nextNode();

	while (textNode && ranges.length < MAX_HIGHLIGHT_RANGES) {
		const text = textNode.nodeValue ?? '';
		const normalizedText = text.toLowerCase();
		let matchIndex = normalizedText.indexOf(normalizedQuery);

		while (matchIndex !== -1 && ranges.length < MAX_HIGHLIGHT_RANGES) {
			const matchEnd = matchIndex + searchQuery.length;
			if (matchEnd <= text.length) {
				const range = document.createRange();
				range.setStart(textNode, matchIndex);
				range.setEnd(textNode, matchEnd);
				ranges.push(range);
			}
			matchIndex = normalizedText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length);
		}

		textNode = walker.nextNode();
	}

	return ranges;
}

function getHighlightRegistry(): HighlightRegistry | null {
	if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') {
		return null;
	}
	return (CSS as typeof CSS & { highlights: HighlightRegistry }).highlights;
}
