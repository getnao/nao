import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { AnchorPosition } from '@/lib/selection-dom.utils';
import {
	createRangeFromOffsets,
	getContainerLeft,
	getSelectionBoundingRect,
	getTextOffset,
	measureRangePosition,
} from '@/lib/selection-dom.utils';
import { trpc } from '@/main';

export type { AnchorPosition };

export interface PersistenceConfig {
	shareId: string;
	contentType: 'chat' | 'story';
}

export interface SelectionState {
	text: string;
	start: number;
	end: number;
	rect: DOMRect;
	containerLeft: number;
}

export interface SelectionAnchor {
	chatId: string;
	start: number;
	end: number;
	rect: DOMRect;
	containerLeft: number;
}

interface SelectionContextValue {
	selection: SelectionState | null;
	clearSelection: () => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
	anchors: SelectionAnchor[];
	openAnchorChatId: string | null;
	addAnchor: (chatId: string, start: number, end: number, rect: DOMRect, containerLeft: number) => void;
	removeAnchor: (chatId: string) => void;
	openAnchor: (chatId: string) => void;
	closePanel: () => void;
	measureAnchorPosition: (start: number, end: number) => AnchorPosition | null;
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

export const SelectionProvider = ({
	children,
	persistenceConfig,
}: {
	children: React.ReactNode;
	persistenceConfig?: PersistenceConfig;
}) => {
	const [selection, setSelection] = useState<SelectionState | null>(null);
	const [anchors, setAnchors] = useState<SelectionAnchor[]>([]);
	const [openAnchorChatId, setOpenAnchorChatId] = useState<string | null>(null);
	const [containerMounted, setContainerMounted] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setContainerMounted(true);
	}, []);

	const selectionForksQuery = useQuery({
		...trpc.chatFork.getSelectionForks.queryOptions({
			shareId: persistenceConfig?.shareId ?? '',
			type: persistenceConfig?.contentType ?? 'chat',
		}),
		enabled: !!persistenceConfig,
	});

	useEffect(() => {
		const selectionForks = selectionForksQuery.data;
		if (!selectionForks || !containerRef.current || !containerMounted) {
			return;
		}

		const hydrated: SelectionAnchor[] = [];
		for (const fork of selectionForks) {
			const anchor = restoreAnchor(containerRef.current, fork.chatId, fork.selectionStart, fork.selectionEnd);
			if (anchor) {
				hydrated.push(anchor);
			}
		}

		if (hydrated.length > 0) {
			setAnchors((prev) => {
				const existing = new Set(prev.map((a) => a.chatId));
				return [...prev, ...hydrated.filter((a) => !existing.has(a.chatId))];
			});
		}
	}, [selectionForksQuery.data, containerMounted]);

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

		const start = getTextOffset(containerRef.current, range.startContainer, range.startOffset);
		const end = getTextOffset(containerRef.current, range.endContainer, range.endOffset);
		const rect = getSelectionBoundingRect(range) ?? range.getBoundingClientRect();
		const containerLeft = getContainerLeft(range);

		setSelection({ text, start, end, rect, containerLeft });
	}, []);

	const addAnchor = useCallback(
		(chatId: string, start: number, end: number, rect: DOMRect, containerLeft: number) => {
			setAnchors((prev) => {
				if (prev.some((a) => a.chatId === chatId)) {
					return prev;
				}
				return [...prev, { chatId, start, end, rect, containerLeft }];
			});
		},
		[],
	);

	const removeAnchor = useCallback((chatId: string) => {
		setAnchors((prev) => prev.filter((a) => a.chatId !== chatId));
		setOpenAnchorChatId((prev) => (prev === chatId ? null : prev));
	}, []);

	const openAnchor = useCallback((chatId: string) => {
		setOpenAnchorChatId(chatId);
	}, []);

	const closePanel = useCallback(() => {
		setOpenAnchorChatId(null);
	}, []);

	const measureAnchorPosition = useCallback((start: number, end: number): AnchorPosition | null => {
		if (!containerRef.current) {
			return null;
		}
		return measureRangePosition(containerRef.current, start, end);
	}, []);

	return (
		<SelectionContext.Provider
			value={{
				selection,
				clearSelection: () => setSelection(null),
				containerRef,
				anchors,
				openAnchorChatId,
				addAnchor,
				removeAnchor,
				openAnchor,
				closePanel,
				measureAnchorPosition,
			}}
		>
			<div ref={containerRef} onMouseUp={handleMouseUp} style={{ display: 'contents' }}>
				{children}
			</div>
		</SelectionContext.Provider>
	);
};

function restoreAnchor(container: Element, chatId: string, start: number, end: number): SelectionAnchor | null {
	const range = createRangeFromOffsets(container, start, end);
	if (!range) {
		return null;
	}

	const text = range.toString().trim();
	if (!text) {
		return null;
	}

	const rect = getSelectionBoundingRect(range) ?? range.getBoundingClientRect();
	const containerLeft = getContainerLeft(range);

	return { chatId, start, end, rect, containerLeft };
}
