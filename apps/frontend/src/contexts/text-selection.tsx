import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { getTextOffset, isRangeInIgnoredRegion } from '@/lib/selection-dom.utils';
import { useMemoObject } from '@/hooks/useMemoObject';
import { isTypingTarget } from '@/lib/keyboard-shortcuts';

export interface SelectionState {
	text: string;
	start: number;
	end: number;
	range: Range;
}

interface SelectionContextValue {
	selection: SelectionState | null;
	clearSelection: () => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
	pageContainerRef: React.RefObject<HTMLDivElement | null>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export const useSelection = (): SelectionContextValue => {
	const ctx = useContext(SelectionContext);
	if (!ctx) {
		throw new Error('useSelection must be used within SelectionProvider');
	}
	return ctx;
};

export const useOptionalSelection = () => useContext(SelectionContext);

export const SelectionProvider = ({ children, resetKey }: { children: React.ReactNode; resetKey?: string }) => {
	const [selection, setSelection] = useState<SelectionState | null>(null);
	const [prevResetKey, setPrevResetKey] = useState(resetKey);
	const containerRef = useRef<HTMLDivElement>(null);
	const pageContainerRef = useContext(SelectionContext)?.pageContainerRef ?? containerRef;

	if (resetKey !== prevResetKey) {
		setPrevResetKey(resetKey);
		setSelection(null);
	}

	useEffect(() => {
		const handleMouseDown = () => setSelection(null);
		document.addEventListener('mousedown', handleMouseDown);
		return () => document.removeEventListener('mousedown', handleMouseDown);
	}, []);

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

		if (isRangeInIgnoredRegion(range, containerRef.current)) {
			return;
		}

		const start = getTextOffset(containerRef.current, range.startContainer, range.startOffset);
		const end = getTextOffset(containerRef.current, range.endContainer, range.endOffset);

		setSelection({ text, start, end, range });
	}, []);

	useEffect(() => {
		const handleKeyUp = (event: KeyboardEvent) => {
			if (isTypingTarget(event)) {
				return;
			}
			if (window.getSelection()?.isCollapsed) {
				setSelection(null);
			} else {
				handleMouseUp();
			}
		};
		document.addEventListener('keyup', handleKeyUp);
		return () => document.removeEventListener('keyup', handleKeyUp);
	}, [handleMouseUp]);

	const clearSelection = useCallback(() => setSelection(null), []);

	const value = useMemoObject({
		selection,
		clearSelection,
		containerRef,
		pageContainerRef,
	});

	return (
		<SelectionContext.Provider value={value}>
			<div ref={containerRef} onMouseUp={handleMouseUp} style={{ display: 'contents' }}>
				{children}
			</div>
		</SelectionContext.Provider>
	);
};
