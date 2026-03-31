export interface SelectionGeometry {
	rect: DOMRect;
	containerLeft: number;
}

export interface AnchorPosition {
	top: number;
	height: number;
	containerLeft: number;
}

/**
 * Creates a DOM Range spanning the given character offsets within a container element.
 * Returns null if the offsets are out of range or the range cannot be created.
 */
export function createRangeFromOffsets(container: Element, start: number, end: number): Range | null {
	if (start < 0 || end < 0 || end < start) {
		return null;
	}

	const range = document.createRange();
	let charCount = 0;
	let startSet = false;
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

	let node: Node | null = walker.nextNode();
	while (node) {
		const len = node.textContent?.length ?? 0;

		if (!startSet && charCount + len >= start) {
			try {
				range.setStart(node, start - charCount);
			} catch {
				return null;
			}
			startSet = true;
		}

		if (startSet && charCount + len >= end) {
			try {
				range.setEnd(node, end - charCount);
			} catch {
				return null;
			}
			return range;
		}

		charCount += len;
		node = walker.nextNode();
	}

	return null;
}

/**
 * Computes the character offset of a node+offset pair relative to a container element.
 */
export function getTextOffset(container: Element, node: Node, offset: number): number {
	if (node.nodeType === Node.TEXT_NODE) {
		let charCount = 0;
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const current = walker.currentNode;
			if (current === node) {
				return charCount + offset;
			}
			charCount += current.textContent?.length ?? 0;
		}
		return -1;
	}

	const boundary = (node as Element).childNodes[offset] ?? null;
	let charCount = 0;
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const current = walker.currentNode;
		if (boundary) {
			if (boundary === current || boundary.contains(current)) {
				break;
			}
			if (!(current.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING)) {
				break;
			}
		} else if (
			!(node as Element).contains(current) &&
			!(current.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
		) {
			break;
		}
		charCount += current.textContent?.length ?? 0;
	}
	return charCount;
}

/** Returns a tight bounding rect for a range by unioning the rects of all its text nodes. */
export function getSelectionBoundingRect(range: Range): DOMRect | null {
	const root =
		range.commonAncestorContainer.nodeType === Node.TEXT_NODE
			? range.commonAncestorContainer.parentNode!
			: range.commonAncestorContainer;

	const rects: DOMRect[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

	let node: Node | null = walker.nextNode();
	while (node) {
		if (range.intersectsNode(node)) {
			const textRange = document.createRange();
			textRange.selectNodeContents(node);
			if (node === range.startContainer) {
				textRange.setStart(node, range.startOffset);
			}
			if (node === range.endContainer) {
				textRange.setEnd(node, range.endOffset);
			}
			rects.push(...Array.from(textRange.getClientRects()));
		}
		node = walker.nextNode();
	}

	if (rects.length === 0) {
		return null;
	}

	const left = Math.min(...rects.map((r) => r.left));
	const top = Math.min(...rects.map((r) => r.top));
	const right = Math.max(...rects.map((r) => r.right));
	const bottom = Math.max(...rects.map((r) => r.bottom));
	return new DOMRect(left, top, right - left, bottom - top);
}

/** Returns the left edge of the nearest `[data-selection-container]` ancestor of the range. */
export function getContainerLeft(range: Range): number {
	const node = range.commonAncestorContainer;
	const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof Element ? node : null;
	const container = el?.closest('[data-selection-container]') ?? document.querySelector('[data-selection-container]');
	if (container) {
		return container.getBoundingClientRect().left;
	}
	return el?.getBoundingClientRect().left ?? 0;
}

/** Measures the screen position of the range for a given start/end offset pair within a container. */
export function measureRangePosition(container: Element, start: number, end: number): AnchorPosition | null {
	const range = createRangeFromOffsets(container, start, end);
	if (!range) {
		return null;
	}
	const rect = getSelectionBoundingRect(range) ?? range.getBoundingClientRect();
	const containerLeft = getContainerLeft(range);
	return { top: rect.top, height: rect.height, containerLeft };
}

/** Returns the geometry (rect + containerLeft) for the current window selection. */
export function getSelectionGeometry(range: Range): SelectionGeometry {
	const rect = getSelectionBoundingRect(range) ?? range.getBoundingClientRect();
	const containerLeft = getContainerLeft(range);
	return { rect, containerLeft };
}
