import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { UIMessage } from '@nao/backend/chat';

export interface SelectionState {
	text: string;
	start: number;
	end: number;
	rect: DOMRect;
}

export interface SelectionAnchor {
	id: string;
	text: string;
	start: number;
	end: number;
	/** Viewport rect captured at selection time — used to position the dot. */
	rect: DOMRect;
	/** Full rendered text of the content area, sent as AI system context. */
	contentText: string;
	messages: UIMessage[];
}

interface SelectionContextValue {
	selection: SelectionState | null;
	clearSelection: () => void;
	anchors: SelectionAnchor[];
	openAnchorId: string | null;
	openAnchorFromSelection: () => void;
	reopenAnchor: (anchorId: string) => void;
	closePanel: () => void;
	updateAnchorMessages: (anchorId: string, messages: UIMessage[]) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export const useSelection = (): SelectionContextValue => {
	const ctx = useContext(SelectionContext);
	if (!ctx) {
		throw new Error('useSelection must be used within SelectionProvider');
	}
	return ctx;
};

export const SelectionProvider = ({ children }: { children: React.ReactNode }) => {
	const [selection, setSelection] = useState<SelectionState | null>(null);
	const [anchors, setAnchors] = useState<SelectionAnchor[]>([]);
	const [openAnchorId, setOpenAnchorId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const handleMouseUp = useCallback(() => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !containerRef.current) {
			return;
		}

		const range = sel.getRangeAt(0);
		const text = sel.toString().trim();

		if (!text || !containerRef.current.contains(range.commonAncestorContainer)) {
			return;
		}

		const start = getTextOffset(containerRef.current, range.startContainer, range.startOffset);
		const end = getTextOffset(containerRef.current, range.endContainer, range.endOffset);
		const rect = getSelectionBoundingRect(range) ?? range.getBoundingClientRect();

		setSelection({ text, start, end, rect });
	}, []);

	const clearSelection = useCallback(() => {
		setSelection(null);
	}, []);

	useEffect(() => {
		const handleMouseDown = () => setSelection(null);
		document.addEventListener('mousedown', handleMouseDown);
		return () => document.removeEventListener('mousedown', handleMouseDown);
	}, []);

	const openAnchorFromSelection = useCallback(() => {
		if (!selection) {
			return;
		}

		const contentText = buildSystemContext(
			containerRef.current?.textContent ?? '',
			selection.text,
			selection.start,
			selection.end,
		);

		const anchor: SelectionAnchor = {
			id: crypto.randomUUID(),
			text: selection.text,
			start: selection.start,
			end: selection.end,
			rect: selection.rect,
			contentText,
			messages: [],
		};

		setAnchors((prev) => [...prev, anchor]);
		setOpenAnchorId(anchor.id);
		setSelection(null);
		window.getSelection()?.removeAllRanges();
	}, [selection]);

	const reopenAnchor = useCallback((anchorId: string) => {
		setOpenAnchorId(anchorId);
	}, []);

	const closePanel = useCallback(() => {
		setOpenAnchorId(null);
	}, []);

	const updateAnchorMessages = useCallback((anchorId: string, messages: UIMessage[]) => {
		setAnchors((prev) => prev.map((a) => (a.id === anchorId ? { ...a, messages } : a)));
	}, []);

	return (
		<SelectionContext.Provider
			value={{
				selection,
				clearSelection,
				anchors,
				openAnchorId,
				openAnchorFromSelection,
				reopenAnchor,
				closePanel,
				updateAnchorMessages,
			}}
		>
			<div ref={containerRef} onMouseUp={handleMouseUp} style={{ display: 'contents' }}>
				{children}
			</div>
		</SelectionContext.Provider>
	);
};

/** Builds the system context sent to the AI: full page text + cited passage reference. */
function buildSystemContext(rawText: string, citedText: string, start: number, end: number): string {
	const truncated = rawText.slice(0, 50_000);
	return [
		'You are a helpful assistant answering questions about a document.',
		'',
		'Full document content:',
		'---',
		truncated,
		'---',
		'',
		`The user has selected this specific passage for discussion (characters ${start}–${end}):`,
		`"${citedText}"`,
		'',
		'Answer questions about this passage using the full document for context. Be concise and precise.',
	].join('\n');
}

/**
 * Walks only the text nodes within the range and unions their rects.
 * This avoids block-level elements (p, div…) whose rects span the full container width,
 * which would push the bubble's centre far from the actual selected words.
 */
function getSelectionBoundingRect(range: Range): DOMRect | null {
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

function getTextOffset(container: Element, node: Node, offset: number): number {
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
