import {
	getGridClass,
	getGridTemplateColumns,
	groupBlocksIntoGrid,
	insertGridColumn,
	parseChartAttributes,
	parseChartBlock,
	parseGridColumns,
	parseTableBlock,
	popGridColumn,
	previewGridColumns,
	reorderGridColumns,
	resizeGridColumns,
	resolveGridWidths,
	setGridColumnsMarkup,
	splitGridColumnsRaw,
	TAG_ATTRS,
} from '@nao/shared/story-segments';
import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { GripVertical } from 'lucide-react';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';

import {
	blockSelectionPluginKey,
	BlockSelection,
	buildBlockMoveTransaction,
	getSelectedBlockPositions,
} from './story-block-selection';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryTableEmbed } from './story-table-embed';
import type { Editor, ReactNodeViewProps } from '@tiptap/react';
import type { Editor as CoreEditor } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Segment } from '@nao/shared/story-segments';
import type {
	DragEvent as ReactDragEvent,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from 'react';
import { replaceUniqueStoryBlockTag } from '@/contexts/story-chart-edit-utils';
import { EditorStoryChartEditProvider } from '@/contexts/story-chart-edit';

// ---------------------------------------------------------------------------
// Encoding helpers for data-raw attributes
// ---------------------------------------------------------------------------

function encodeForAttr(str: string): string {
	return btoa(encodeURIComponent(str));
}

function decodeFromAttr(encoded: string): string {
	return decodeURIComponent(atob(encoded));
}

function cloneElementWithStyles(node: HTMLElement): HTMLElement {
	const clone = node.cloneNode(true) as HTMLElement;
	const sources = [node, ...Array.from(node.getElementsByTagName('*'))];
	const targets = [clone, ...Array.from(clone.getElementsByTagName('*'))];
	sources.forEach((source, index) => {
		const target = targets[index];
		if (!(target instanceof HTMLElement || target instanceof SVGElement)) {
			return;
		}
		const computed = window.getComputedStyle(source as Element);
		let cssText = '';
		for (const property of computed) {
			cssText += `${property}:${computed.getPropertyValue(property)};`;
		}
		target.style.cssText = cssText;
	});
	return clone;
}

function dispatchDropWithScroll(view: EditorView, transaction: Transaction, pos: number): void {
	const target = Math.max(0, Math.min(pos, transaction.doc.content.size));
	transaction.setSelection(Selection.near(transaction.doc.resolve(target)));
	view.dispatch(transaction);
	requestAnimationFrame(() => {
		const clamped = Math.max(0, Math.min(pos, view.state.doc.content.size));
		const dom = view.nodeDOM(clamped);
		const element = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
		element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});
}

/**
 * Replaces custom <chart />, <table /> and <grid> tags with HTML-safe elements that
 * Tiptap's DOMParser can match against custom node extensions.
 */
export function preprocessForEditor(code: string): string {
	// Each embed is wrapped in a <div> so that `marked` emits an "html" token
	// instead of folding the custom element into a paragraph token (marked only
	// recognises standard HTML block elements like <div>).
	let result = code.replace(/<grid(?:\s+[^>]*)?>[\s\S]*?<\/grid>/g, (match) => {
		return `<div><grid-embed data-raw="${encodeForAttr(match)}"></grid-embed></div>\n\n`;
	});

	result = result.replace(new RegExp(`<chart\\s+${TAG_ATTRS}\\/?>`, 'g'), (match) => {
		return `<div><chart-embed data-raw="${encodeForAttr(match)}"></chart-embed></div>\n\n`;
	});

	result = result.replace(new RegExp(`<table\\s+${TAG_ATTRS}\\/?>`, 'g'), (match) => {
		return `<div><table-embed data-raw="${encodeForAttr(match)}"></table-embed></div>\n\n`;
	});

	return result;
}

// ---------------------------------------------------------------------------
// ChartBlock extension – atom node rendered as an interactive chart
// ---------------------------------------------------------------------------

const STORY_BLOCK_DRAG_TYPE = 'application/x-nao-story-block';

type CardOrigin = { kind: 'block'; pos: number } | { kind: 'gridColumn'; gridPos: number; columnIndex: number };

type StoryBlockDragSource = {
	markup: string;
	origin: CardOrigin;
};

const StoryBlockDragContext = createContext<{
	sourceRef: React.MutableRefObject<StoryBlockDragSource | null>;
	isDragging: boolean;
	setDragging: (value: boolean) => void;
} | null>(null);

const GRID_COLUMN_DRAG_TYPE = 'application/x-nao-grid-column';

type GridDragSource = {
	gridPos: number;
	columnIndex: number;
};

const GridDragContext = createContext<React.MutableRefObject<GridDragSource | null> | null>(null);

type StoryBlockDropSide = 'left' | 'right';

export function StoryBlockDragGrip({ node, getPos }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'>) {
	const dragContext = useContext(StoryBlockDragContext);

	const handleDragStart = useCallback(
		(event: ReactDragEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			const pos = getPos();
			if (typeof pos !== 'number' || !dragContext) {
				return;
			}
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(STORY_BLOCK_DRAG_TYPE, '1');
			dragContext.sourceRef.current = {
				markup: node.attrs.rawTag as string,
				origin: { kind: 'block', pos },
			};
			dragContext.setDragging(true);
		},
		[dragContext, getPos, node.attrs.rawTag],
	);

	const handleDragEnd = useCallback(
		(event: ReactDragEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			if (dragContext) {
				dragContext.setDragging(false);
				dragContext.sourceRef.current = null;
			}
		},
		[dragContext],
	);

	return (
		<button
			type='button'
			aria-label='Move story block'
			contentEditable={false}
			className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
			draggable
			onClick={(event) => {
				event.stopPropagation();
			}}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<GripVertical className='size-3.5' />
		</button>
	);
}

export function StoryBlockDropZones({ node, editor, getPos }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'>) {
	const dragContext = useContext(StoryBlockDragContext);
	const gridDragSourceRef = useContext(GridDragContext);
	const [hoverSide, setHoverSide] = useState<StoryBlockDropSide | null>(null);
	const currentPos = getPos();
	const sourceOrigin = dragContext?.sourceRef.current?.origin;
	const isDropTarget =
		typeof currentPos === 'number' &&
		dragContext?.isDragging === true &&
		dragContext.sourceRef.current !== null &&
		!(sourceOrigin?.kind === 'block' && sourceOrigin.pos === currentPos);

	useEffect(() => {
		if (!dragContext?.isDragging) {
			setHoverSide(null);
		}
	}, [dragContext?.isDragging]);

	const resetDrag = useCallback(() => {
		setHoverSide(null);
		if (dragContext) {
			dragContext.setDragging(false);
			dragContext.sourceRef.current = null;
		}
		if (gridDragSourceRef) {
			gridDragSourceRef.current = null;
		}
	}, [dragContext, gridDragSourceRef]);

	const handleDrop = useCallback(
		(side: StoryBlockDropSide, event: ReactDragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const source = dragContext?.sourceRef.current;
			const targetPos = getPos();
			if (
				!source ||
				typeof targetPos !== 'number' ||
				(source.origin.kind === 'block' && source.origin.pos === targetPos)
			) {
				resetDrag();
				return;
			}

			const state = editor.state;
			const targetMarkup = node.attrs.rawTag as string;
			const leftMarkup = side === 'left' ? source.markup : targetMarkup;
			const rightMarkup = side === 'left' ? targetMarkup : source.markup;
			const gridNode = createBlockNode(state.schema, groupBlocksIntoGrid(leftMarkup, rightMarkup));
			if (!gridNode) {
				resetDrag();
				return;
			}

			const transaction = state.tr;
			transaction.replaceWith(targetPos, targetPos + node.nodeSize, gridNode);
			removeCardFromOrigin(transaction, state, source.origin);
			editor.view.dispatch(transaction);
			resetDrag();
		},
		[dragContext, editor, getPos, node, resetDrag],
	);

	return (
		isDropTarget &&
		(['left', 'right'] as const).map((side) => (
			<div
				key={side}
				contentEditable={false}
				className={`absolute inset-y-0 z-30 w-1/2 ${side === 'left' ? 'left-0' : 'right-0'}`}
				onDragOver={(event) => {
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = 'move';
					setHoverSide(side);
				}}
				onDragLeave={() => {
					setHoverSide(null);
				}}
				onDrop={(event) => {
					handleDrop(side, event);
				}}
			>
				{hoverSide === side && (
					<div
						className={`pointer-events-none absolute inset-y-0 w-0.5 bg-primary ${
							side === 'left' ? 'left-0' : 'right-0'
						}`}
					/>
				)}
			</div>
		))
	);
}

function ChartBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const chart = useMemo(() => {
		const attrMatch = rawTag.match(new RegExp(`<chart\\s+(${TAG_ATTRS})\\/?>`));
		if (!attrMatch) {
			return null;
		}
		const parsed = parseChartBlock(attrMatch[1]);
		return parsed ? { ...parsed, rawTag } : null;
	}, [rawTag]);

	const handleReplaceTag = useCallback(
		(_rawTag: string, nextTag: string) => updateAttributes({ rawTag: nextTag }),
		[updateAttributes],
	);

	if (!chart) {
		return (
			<NodeViewWrapper draggable data-type='chart-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid chart block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='chart-block'>
			<div className='group relative my-2'>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<EditorStoryChartEditProvider onReplaceTag={handleReplaceTag}>
					<StoryChartEmbed
						chart={chart}
						dragHandle={<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />}
					/>
				</EditorStoryChartEditProvider>
			</div>
		</NodeViewWrapper>
	);
}

const ChartBlock = Node.create({
	name: 'chartBlock',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			rawTag: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'chart-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					return { rawTag: decodeFromAttr(encoded) };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['chart-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(ChartBlockView);
	},

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});

// ---------------------------------------------------------------------------
// TableBlock extension – atom node rendered as a SQL table
// ---------------------------------------------------------------------------

function TableBlockView({ node, editor, getPos }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const table = useMemo(() => {
		const attrMatch = rawTag.match(new RegExp(`<table\\s+(${TAG_ATTRS})\\/?>`));
		if (!attrMatch) {
			return null;
		}
		const parsed = parseTableBlock(attrMatch[1]);
		return parsed ? { ...parsed, rawTag } : null;
	}, [rawTag]);

	if (!table) {
		return (
			<NodeViewWrapper draggable data-type='table-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid table block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='table-block'>
			<div className='group relative my-2'>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<StoryTableEmbed
					table={table}
					dragHandle={<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />}
				/>
			</div>
		</NodeViewWrapper>
	);
}

const TableBlock = Node.create({
	name: 'tableBlock',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			rawTag: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'table-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					return { rawTag: decodeFromAttr(encoded) };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['table-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(TableBlockView);
	},

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});

// ---------------------------------------------------------------------------
// GridBlock extension – atom node rendered as a grid of charts/markdown
// ---------------------------------------------------------------------------

interface GridResizeDrag {
	boundaryIndex: number;
	contentLeft: number;
	contentWidth: number;
	gapWidth: number;
	targetFraction: number;
	widths: number[];
}

function createBlockNode(schema: Schema, markup: string): PMNode | null {
	const trimmedMarkup = markup.trim();
	if (trimmedMarkup.startsWith('<chart')) {
		return schema.nodes.chartBlock?.create({ rawTag: trimmedMarkup }) ?? null;
	}
	if (trimmedMarkup.startsWith('<table')) {
		return schema.nodes.tableBlock?.create({ rawTag: trimmedMarkup }) ?? null;
	}
	if (trimmedMarkup.startsWith('<grid')) {
		return schema.nodes.gridBlock?.create({ rawContent: trimmedMarkup }) ?? null;
	}

	const paragraph = schema.nodes.paragraph;
	if (!paragraph) {
		return null;
	}
	return paragraph.create(null, trimmedMarkup ? schema.text(trimmedMarkup) : undefined);
}

function removeCardFromOrigin(transaction: Transaction, state: EditorState, origin: CardOrigin): void {
	if (origin.kind === 'block') {
		const node = state.doc.nodeAt(origin.pos);
		if (!node) {
			return;
		}
		transaction.delete(transaction.mapping.map(origin.pos), transaction.mapping.map(origin.pos + node.nodeSize));
		return;
	}

	const gridNode = state.doc.nodeAt(origin.gridPos);
	if (!gridNode || gridNode.type.name !== 'gridBlock') {
		return;
	}
	const result = popGridColumn(gridNode.attrs.rawContent as string, origin.columnIndex);
	if (!result) {
		return;
	}
	const remainingNode = createBlockNode(state.schema, result.remaining);
	if (!remainingNode) {
		return;
	}
	transaction.replaceWith(
		transaction.mapping.map(origin.gridPos),
		transaction.mapping.map(origin.gridPos + gridNode.nodeSize),
		remainingNode,
	);
}

function getResizeTargetFraction(drag: GridResizeDrag, clientX: number): number {
	const gapOffset = drag.boundaryIndex * drag.gapWidth + drag.gapWidth / 2;
	const pointerX = clientX - drag.contentLeft - gapOffset;
	return Math.min(Math.max(pointerX / drag.contentWidth, 0), 1);
}

function GridBlockView({ node, updateAttributes, getPos, editor }: ReactNodeViewProps) {
	const rawContent = node.attrs.rawContent as string;
	const gridDragSourceRef = useContext(GridDragContext);
	const storyBlockDrag = useContext(StoryBlockDragContext);
	const gridRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<GridResizeDrag | null>(null);
	const [liveWidths, setLiveWidths] = useState<number[] | null>(null);
	const [activeBoundary, setActiveBoundary] = useState<number | null>(null);
	const [dragColumnIndex, setDragColumnIndex] = useState<number | null>(null);
	const [dropColumnIndex, setDropColumnIndex] = useState<number | null>(null);
	const [blockDropIndex, setBlockDropIndex] = useState<number | null>(null);

	const { segments, cols, widths } = useMemo(() => {
		const gridMatch = rawContent.match(/<grid(?:\s+([^>]*))?>([\s\S]*?)<\/grid>/);
		if (!gridMatch) {
			return { segments: [] as Segment[], cols: 2, widths: null };
		}
		const attrs = parseChartAttributes(gridMatch[1] ?? '');
		const { children, spans } = parseGridColumns(gridMatch[2]);
		return {
			segments: children,
			cols: parseInt(attrs.cols || '2', 10),
			widths:
				attrs.widths !== undefined
					? resolveGridWidths(attrs.widths, children.length)
					: spans.some((span) => span > 1)
						? spans
						: null,
		};
	}, [rawContent]);

	useEffect(() => {
		setLiveWidths(null);
	}, [rawContent]);

	useEffect(() => {
		if (!storyBlockDrag?.isDragging) {
			setBlockDropIndex(null);
			setDropColumnIndex(null);
			setDragColumnIndex(null);
		}
	}, [storyBlockDrag?.isDragging]);

	const handleReplaceTag = useCallback(
		(rawTag: string, nextTag: string) => {
			const nextContent = replaceUniqueStoryBlockTag(rawContent, rawTag, nextTag);
			if (nextContent !== rawContent) {
				updateAttributes({ rawContent: nextContent });
			}
		},
		[rawContent, updateAttributes],
	);

	const clearColumnDrag = useCallback(() => {
		setDragColumnIndex(null);
		setDropColumnIndex(null);
	}, []);

	const clearBlockDrag = useCallback(() => {
		setBlockDropIndex(null);
		if (storyBlockDrag) {
			storyBlockDrag.setDragging(false);
			storyBlockDrag.sourceRef.current = null;
		}
	}, [storyBlockDrag]);

	const clearDrag = useCallback(() => {
		clearColumnDrag();
		clearBlockDrag();
		if (gridDragSourceRef) {
			gridDragSourceRef.current = null;
		}
	}, [clearBlockDrag, clearColumnDrag, gridDragSourceRef]);

	const handleColumnDragStart = useCallback(
		(columnIndex: number, event: ReactDragEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(GRID_COLUMN_DRAG_TYPE, String(columnIndex));
			event.dataTransfer.setData(STORY_BLOCK_DRAG_TYPE, '1');
			const gridPos = getPos();
			if (typeof gridPos === 'number' && gridDragSourceRef) {
				gridDragSourceRef.current = { gridPos, columnIndex };
			}
			if (typeof gridPos === 'number' && storyBlockDrag) {
				const columnMarkup = splitGridColumnsRaw(rawContent).columns[columnIndex] ?? '';
				storyBlockDrag.sourceRef.current = {
					markup: columnMarkup,
					origin: { kind: 'gridColumn', gridPos, columnIndex },
				};
				storyBlockDrag.setDragging(true);
			}
			setDragColumnIndex(columnIndex);
			setDropColumnIndex(null);
			setBlockDropIndex(null);
		},
		[getPos, gridDragSourceRef, rawContent, storyBlockDrag],
	);

	const handleGridDragOver = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			if (dragColumnIndex !== null) {
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'move';
				const grid = gridRef.current;
				const bounds = grid?.getBoundingClientRect();
				if (!grid || !bounds) {
					return;
				}

				const columnElements = Array.from(grid.children);
				const insertionIndex = columnElements.findIndex((element) => {
					const columnBounds = element.getBoundingClientRect();
					return event.clientX < columnBounds.left + columnBounds.width / 2;
				});
				setDropColumnIndex(insertionIndex === -1 ? columnElements.length : insertionIndex);
				return;
			}

			const isExternalStoryBlock =
				storyBlockDrag?.isDragging === true && storyBlockDrag.sourceRef.current !== null;
			if (!isExternalStoryBlock) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'move';
			const grid = gridRef.current;
			if (!grid) {
				return;
			}

			const columnElements = Array.from(grid.children);
			const insertionIndex = columnElements.findIndex((element) => {
				const columnBounds = element.getBoundingClientRect();
				return event.clientX < columnBounds.left + columnBounds.width / 2;
			});
			setDropColumnIndex(null);
			setBlockDropIndex(insertionIndex === -1 ? segments.length : insertionIndex);
		},
		[dragColumnIndex, segments.length, storyBlockDrag],
	);

	const insertExternalStoryBlock = useCallback(
		(index: number) => {
			const source = storyBlockDrag?.sourceRef.current;
			const gridPos = getPos();
			if (!source || typeof gridPos !== 'number') {
				clearDrag();
				return;
			}
			if (source.origin.kind === 'gridColumn' && source.origin.gridPos === gridPos) {
				clearDrag();
				return;
			}

			const clampedIndex = Math.max(0, Math.min(index, segments.length));
			const state = editor.state;
			const newGrid = insertGridColumn(rawContent, source.markup, clampedIndex);
			if (newGrid === rawContent) {
				clearDrag();
				return;
			}

			const transaction = state.tr;
			transaction.setNodeAttribute(gridPos, 'rawContent', newGrid);
			removeCardFromOrigin(transaction, state, source.origin);
			editor.view.dispatch(transaction);
			clearDrag();
		},
		[clearDrag, editor, getPos, rawContent, segments.length, storyBlockDrag],
	);

	const handleGridDrop = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			if (dragColumnIndex !== null) {
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'move';
				if (dropColumnIndex !== null) {
					const targetIndex = dropColumnIndex > dragColumnIndex ? dropColumnIndex - 1 : dropColumnIndex;
					const nextRawContent = reorderGridColumns(rawContent, dragColumnIndex, targetIndex);
					if (nextRawContent !== rawContent) {
						updateAttributes({ rawContent: nextRawContent });
					}
				}

				clearDrag();
				return;
			}

			const isExternalStoryBlock =
				storyBlockDrag?.isDragging === true && storyBlockDrag.sourceRef.current !== null;
			if (!isExternalStoryBlock) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			insertExternalStoryBlock(blockDropIndex ?? segments.length);
		},
		[
			blockDropIndex,
			clearDrag,
			dragColumnIndex,
			dropColumnIndex,
			insertExternalStoryBlock,
			rawContent,
			segments.length,
			storyBlockDrag,
			updateAttributes,
		],
	);

	const handleResizeStart = useCallback(
		(boundaryIndex: number, event: ReactPointerEvent<HTMLButtonElement>) => {
			const grid = gridRef.current;
			if (!grid) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			const bounds = grid.getBoundingClientRect();
			const gapWidth = parseFloat(getComputedStyle(grid).columnGap) || 0;
			const contentWidth = bounds.width - gapWidth * (segments.length - 1);
			if (contentWidth <= 0) {
				return;
			}

			const currentWidths = liveWidths ?? widths ?? segments.map(() => 1);
			dragRef.current = {
				boundaryIndex,
				contentLeft: bounds.left,
				contentWidth,
				gapWidth,
				targetFraction: 0,
				widths: currentWidths,
			};
			setLiveWidths(currentWidths);
			setActiveBoundary(boundaryIndex);
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[liveWidths, segments, widths],
	);

	const updateResize = useCallback((clientX: number) => {
		const drag = dragRef.current;
		if (!drag) {
			return null;
		}

		const targetFraction = getResizeTargetFraction(drag, clientX);
		drag.targetFraction = targetFraction;
		const nextWidths = previewGridColumns(drag.widths, drag.boundaryIndex, targetFraction);
		setLiveWidths(nextWidths);
		return nextWidths;
	}, []);

	const finishResize = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>, updateFromPointer: boolean) => {
			const drag = dragRef.current;
			if (!drag) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			if (updateFromPointer) {
				drag.targetFraction = getResizeTargetFraction(drag, event.clientX);
			}
			const nextWidths = updateFromPointer
				? resizeGridColumns(drag.widths, drag.boundaryIndex, drag.targetFraction)
				: null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			dragRef.current = null;
			setActiveBoundary(null);

			if (!nextWidths) {
				setLiveWidths(null);
				return;
			}
			const nextRawContent = setGridColumnsMarkup(rawContent, nextWidths);
			if (nextRawContent !== rawContent) {
				updateAttributes({ rawContent: nextRawContent });
			} else {
				setLiveWidths(null);
			}
		},
		[rawContent, updateAttributes],
	);

	const visualWidths = liveWidths ?? widths;
	const handleResizeKeyDown = useCallback(
		(boundaryIndex: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			const currentWidths = liveWidths ?? widths ?? segments.map(() => 1);
			const total = currentWidths.reduce((sum, width) => sum + width, 0);
			const boundary = currentWidths.slice(0, boundaryIndex + 1).reduce((sum, width) => sum + width, 0);
			const direction = event.key === 'ArrowLeft' ? -1 : 1;
			const nextWidths = resizeGridColumns(currentWidths, boundaryIndex, boundary / total + direction / 6);
			const nextRawContent = setGridColumnsMarkup(rawContent, nextWidths);
			if (nextRawContent !== rawContent) {
				setLiveWidths(nextWidths);
				updateAttributes({ rawContent: nextRawContent });
			}
		},
		[liveWidths, rawContent, segments, updateAttributes, widths],
	);

	const resizeHandlePositions = useMemo(() => {
		const positionedWidths = visualWidths ?? segments.map(() => 1);
		const total = positionedWidths.reduce((sum, width) => sum + width, 0);
		let cumulativeWidth = 0;
		return positionedWidths.slice(0, -1).map((width, index) => {
			cumulativeWidth += width;
			const fraction = cumulativeWidth / total;
			return {
				index,
				left: `calc(${fraction * 100}% - ${fraction * 16 * (positionedWidths.length - 1)}px + ${(index + 0.5) * 16}px)`,
			};
		});
	}, [segments, visualWidths]);

	const indicatorIndex = blockDropIndex ?? dropColumnIndex;
	const dropIndicatorLeft =
		indicatorIndex === null
			? null
			: indicatorIndex === 0
				? '0%'
				: indicatorIndex === segments.length
					? '100%'
					: resizeHandlePositions[indicatorIndex - 1]?.left;
	const externalBlockSource = storyBlockDrag?.sourceRef.current;
	const gridPos = getPos();
	const externalBlockActive =
		storyBlockDrag?.isDragging === true &&
		externalBlockSource !== null &&
		externalBlockSource !== undefined &&
		!(externalBlockSource.origin.kind === 'gridColumn' && externalBlockSource.origin.gridPos === gridPos);

	return (
		<NodeViewWrapper draggable data-type='grid-block'>
			<div
				className='@container relative my-2'
				onDragOver={handleGridDragOver}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
						setBlockDropIndex(null);
					}
				}}
				onDrop={handleGridDrop}
			>
				<div
					ref={gridRef}
					className={
						visualWidths !== null
							? 'grid grid-cols-1 gap-4 @lg:[grid-template-columns:var(--nao-grid-cols)]'
							: `grid ${getGridClass(cols)} gap-4`
					}
					{...(visualWidths !== null
						? { style: { ['--nao-grid-cols' as string]: getGridTemplateColumns(visualWidths) } }
						: {})}
				>
					{segments.map((segment, i) => {
						const columnGrip =
							segments.length >= 2 ? (
								<button
									type='button'
									aria-label={`Move column ${i + 1}`}
									contentEditable={false}
									draggable
									className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
									onClick={(event) => {
										event.stopPropagation();
									}}
									onPointerDown={(event) => {
										event.stopPropagation();
									}}
									onDragStart={(event) => {
										handleColumnDragStart(i, event);
									}}
									onDragEnd={(event) => {
										event.stopPropagation();
										clearDrag();
									}}
								>
									<GripVertical className='size-3.5' />
								</button>
							) : null;

						return (
							<div key={i} className='group relative min-w-0'>
								{segment.type === 'markdown' ? (
									<>
										{columnGrip !== null && (
											<div className='absolute right-1 top-1 z-20 opacity-0 transition-opacity group-hover:opacity-100'>
												{columnGrip}
											</div>
										)}
										<Streamdown mode='static'>{segment.content}</Streamdown>
									</>
								) : segment.type === 'chart' ? (
									<EditorStoryChartEditProvider onReplaceTag={handleReplaceTag}>
										<StoryChartEmbed chart={segment.chart} dragHandle={columnGrip} />
									</EditorStoryChartEditProvider>
								) : segment.type === 'table' ? (
									<StoryTableEmbed table={segment.table} dragHandle={columnGrip} />
								) : null}
							</div>
						);
					})}
				</div>
				{externalBlockActive && (
					<>
						<div
							contentEditable={false}
							className='absolute inset-y-0 -left-3 z-40 w-8'
							onDragOver={(event) => {
								event.preventDefault();
								event.stopPropagation();
								event.dataTransfer.dropEffect = 'move';
								setBlockDropIndex(0);
							}}
							onDrop={(event) => {
								event.preventDefault();
								event.stopPropagation();
								insertExternalStoryBlock(0);
							}}
						/>
						<div
							contentEditable={false}
							className='absolute inset-y-0 -right-3 z-40 w-8'
							onDragOver={(event) => {
								event.preventDefault();
								event.stopPropagation();
								event.dataTransfer.dropEffect = 'move';
								setBlockDropIndex(segments.length);
							}}
							onDrop={(event) => {
								event.preventDefault();
								event.stopPropagation();
								insertExternalStoryBlock(segments.length);
							}}
						/>
					</>
				)}
				{dropIndicatorLeft !== null && (
					<div
						contentEditable={false}
						className='pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-primary'
						style={{ left: dropIndicatorLeft }}
					/>
				)}
				{resizeHandlePositions.map(({ index, left }) => (
					<button
						key={index}
						type='button'
						aria-label={`Resize columns ${index + 1} and ${index + 2}`}
						contentEditable={false}
						className='group absolute inset-y-0 z-10 hidden w-4 -translate-x-1/2 cursor-col-resize touch-none select-none @lg:block'
						draggable={false}
						style={{ left }}
						onKeyDown={(event) => {
							handleResizeKeyDown(index, event);
						}}
						onPointerDown={(event) => {
							handleResizeStart(index, event);
						}}
						onPointerMove={(event) => {
							if (event.currentTarget.hasPointerCapture(event.pointerId)) {
								updateResize(event.clientX);
							}
						}}
						onPointerUp={(event) => {
							finishResize(event, true);
						}}
						onPointerCancel={(event) => {
							finishResize(event, false);
						}}
					>
						<div
							className={`mx-auto h-full w-0.5 transition-colors ${
								activeBoundary === index
									? 'bg-primary'
									: 'bg-border/50 group-hover:bg-primary group-focus-visible:bg-primary'
							}`}
						/>
					</button>
				))}
			</div>
		</NodeViewWrapper>
	);
}

const GridBlock = Node.create({
	name: 'gridBlock',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			rawContent: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'grid-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					return { rawContent: decodeFromAttr(encoded) };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['grid-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(GridBlockView);
	},

	renderMarkdown(node) {
		const rawContent = typeof node.attrs?.rawContent === 'string' ? node.attrs.rawContent : '';
		return `${rawContent}\n\n`;
	},
});

// ---------------------------------------------------------------------------
// TableDeleteShortcuts – lets users delete markdown tables via keyboard
// ---------------------------------------------------------------------------
// ProseMirror's table plugin intercepts Backspace/Delete to handle cell
// operations, which prevents deletion of the table node itself. This
// extension runs at higher priority so its shortcuts fire first:
//   - Backspace/Delete in an empty table → remove the table
//   - Mod-Shift-Backspace in any table   → force-remove the table

const TableDeleteShortcuts = Extension.create({
	name: 'tableDeleteShortcuts',
	priority: 150,

	addKeyboardShortcuts() {
		const findEnclosingTable = (editor: CoreEditor) => {
			const { $anchor } = editor.state.selection;
			for (let depth = $anchor.depth; depth > 0; depth--) {
				const node = $anchor.node(depth);
				if (node.type.name === 'table') {
					return node;
				}
			}
			return null;
		};

		const deleteIfEmpty = ({ editor }: { editor: CoreEditor }): boolean => {
			const table = findEnclosingTable(editor);
			if (table && !table.textContent) {
				return editor.commands.deleteTable();
			}
			return false;
		};

		return {
			Backspace: deleteIfEmpty,
			Delete: deleteIfEmpty,
			'Mod-Shift-Backspace': ({ editor }) => {
				if (findEnclosingTable(editor)) {
					return editor.commands.deleteTable();
				}
				return false;
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

const EDITOR_EXTENSIONS = [
	StarterKit.configure({
		dropcursor: { width: 3, class: 'drop-cursor', color: false },
	}),
	TableKit,
	TableDeleteShortcuts,
	Markdown.configure({
		markedOptions: {
			gfm: true,
		},
	}),
	ChartBlock,
	TableBlock,
	GridBlock,
	BlockSelection,
];

interface StoryEditorProps {
	code: string;
	editorRef: React.MutableRefObject<Editor | null>;
	onSave?: () => void;
}

export const StoryEditor = memo(function StoryEditor({ code, editorRef, onSave }: StoryEditorProps) {
	const processedContent = useMemo(() => preprocessForEditor(code), [code]);
	const onSaveRef = useRef(onSave);
	const gridDragSourceRef = useRef<GridDragSource | null>(null);
	const storyBlockSourceRef = useRef<StoryBlockDragSource | null>(null);
	const multiBlockDragRef = useRef<number[] | null>(null);
	const handleNodePosRef = useRef<number | null>(null);
	const dragPreviewPositionsRef = useRef<number[] | null>(null);
	const storyEditorRef = useRef<HTMLDivElement>(null);
	const [isBlockDragging, setIsBlockDragging] = useState(false);
	const [handleNodeType, setHandleNodeType] = useState<string | null>(null);
	const storyBlockDragContext = useMemo(
		() => ({
			sourceRef: storyBlockSourceRef,
			isDragging: isBlockDragging,
			setDragging: setIsBlockDragging,
		}),
		[isBlockDragging],
	);
	const resetDragContexts = useCallback(() => {
		gridDragSourceRef.current = null;
		storyBlockSourceRef.current = null;
		multiBlockDragRef.current = null;
		setIsBlockDragging(false);
	}, []);
	const handleDragHandleNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
		setHandleNodeType(node?.type.name ?? null);
		handleNodePosRef.current = node ? pos : null;
	}, []);
	onSaveRef.current = onSave;

	const extensions = useMemo(
		() => [
			...EDITOR_EXTENSIONS,
			Extension.create({
				name: 'saveShortcut',
				addKeyboardShortcuts() {
					return {
						'Mod-s': () => {
							onSaveRef.current?.();
							return true;
						},
					};
				},
			}),
		],
		[],
	);

	const editor = useEditor({
		extensions,
		content: processedContent,
		contentType: 'markdown',
		editorProps: {
			handleDOMEvents: {
				dragover(_view, event) {
					if (
						event.dataTransfer?.types.includes(GRID_COLUMN_DRAG_TYPE) ||
						event.dataTransfer?.types.includes(STORY_BLOCK_DRAG_TYPE)
					) {
						event.preventDefault();
					}
					return false;
				},
			},
			handleDrop(view, event) {
				const dataTransfer = event.dataTransfer;
				if (multiBlockDragRef.current && multiBlockDragRef.current.length > 1) {
					try {
						const positions = multiBlockDragRef.current;
						const { state } = view;
						const nodes = positions
							.map((position) => state.doc.nodeAt(position))
							.filter((node): node is PMNode => node != null);
						if (nodes.length === 0) {
							return true;
						}

						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}

						const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
						const insertPos = dropPoint(state.doc, coords.pos, slice) ?? coords.pos;
						const move = buildBlockMoveTransaction(state, positions, insertPos);
						if (!move) {
							return true;
						}

						dispatchDropWithScroll(view, move.transaction, move.insertPos);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				if (dataTransfer?.types.includes(GRID_COLUMN_DRAG_TYPE)) {
					try {
						const source = gridDragSourceRef.current;
						if (!source) {
							return true;
						}

						const { state } = view;
						const gridNode = state.doc.nodeAt(source.gridPos);
						if (!gridNode || gridNode.type.name !== 'gridBlock') {
							return true;
						}

						const result = popGridColumn(gridNode.attrs.rawContent as string, source.columnIndex);
						if (!result) {
							return true;
						}

						const poppedNode = createBlockNode(state.schema, result.popped);
						const remainingNode = createBlockNode(state.schema, result.remaining);
						if (!poppedNode || !remainingNode) {
							return true;
						}

						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}

						const gridFrom = source.gridPos;
						const gridTo = source.gridPos + gridNode.nodeSize;
						const slice = new Slice(Fragment.from(poppedNode), 0, 0);
						let insertPos = dropPoint(state.doc, coords.pos, slice) ?? coords.pos;
						if (insertPos > gridFrom && insertPos < gridTo) {
							insertPos = gridTo;
						}

						const transaction = state.tr;
						transaction.replaceWith(gridFrom, gridTo, remainingNode);
						const poppedPos = transaction.mapping.map(insertPos, -1);
						transaction.insert(poppedPos, poppedNode);
						dispatchDropWithScroll(view, transaction, poppedPos);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				if (dataTransfer?.types.includes(STORY_BLOCK_DRAG_TYPE)) {
					try {
						const source = storyBlockSourceRef.current;
						if (!source) {
							return true;
						}

						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}

						const node = createBlockNode(view.state.schema, source.markup);
						if (!node) {
							return true;
						}

						const slice = new Slice(Fragment.from(node), 0, 0);
						const insertPos = dropPoint(view.state.doc, coords.pos, slice) ?? coords.pos;
						if (source.origin.kind === 'block') {
							const originNode = view.state.doc.nodeAt(source.origin.pos);
							const originTo = originNode ? source.origin.pos + originNode.nodeSize : source.origin.pos;
							if (insertPos >= source.origin.pos && insertPos <= originTo) {
								return true;
							}
						}

						const transaction = view.state.tr;
						transaction.insert(insertPos, node);
						removeCardFromOrigin(transaction, view.state, source.origin);
						dispatchDropWithScroll(view, transaction, transaction.mapping.map(insertPos, -1));
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				return false;
			},
		},
	});

	useEffect(() => {
		const container = storyEditorRef.current;
		if (!container || !editor) {
			return;
		}

		const onDragStart = (event: DragEvent) => {
			const positions = dragPreviewPositionsRef.current;
			if (!positions || positions.length === 0 || !event.dataTransfer) {
				return;
			}

			const nodes = positions
				.map((position) => editor.view.nodeDOM(position))
				.filter((dom): dom is HTMLElement => dom instanceof HTMLElement);
			if (nodes.length === 0) {
				return;
			}

			const preview = document.createElement('div');
			preview.style.position = 'absolute';
			preview.style.top = '-10000px';
			preview.style.left = '-10000px';

			for (const dom of nodes) {
				preview.appendChild(cloneElementWithStyles(dom));
			}

			document.body.appendChild(preview);
			event.dataTransfer.setDragImage(preview, 16, 16);

			const cleanup = () => {
				preview.remove();
				document.removeEventListener('dragend', cleanup);
				document.removeEventListener('drop', cleanup);
			};
			document.addEventListener('dragend', cleanup);
			document.addEventListener('drop', cleanup);
		};

		const clearDropCursor = () => {
			dragPreviewPositionsRef.current = null;
			editor.view.dom.dispatchEvent(new DragEvent('dragleave'));
		};

		container.addEventListener('dragstart', onDragStart);
		document.addEventListener('dragend', clearDropCursor, true);
		document.addEventListener('drop', clearDropCursor, true);
		return () => {
			container.removeEventListener('dragstart', onDragStart);
			document.removeEventListener('dragend', clearDropCursor, true);
			document.removeEventListener('drop', clearDropCursor, true);
		};
	}, [editor]);

	useEffect(() => {
		editorRef.current = editor;
		return () => {
			editorRef.current = null;
		};
	}, [editor, editorRef]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		if (getEditorMarkdown(editor) === code) {
			return;
		}
		editor.commands.setContent(processedContent, { emitUpdate: false, contentType: 'markdown' });
	}, [editor, code, processedContent]);

	return (
		<GridDragContext.Provider value={gridDragSourceRef}>
			<StoryBlockDragContext.Provider value={storyBlockDragContext}>
				<div ref={storyEditorRef} className='story-editor relative'>
					{editor && (
						<DragHandle
							editor={editor}
							className='drag-handle'
							onNodeChange={handleDragHandleNodeChange}
							onElementDragStart={(event) => {
								const selected = getSelectedBlockPositions(editor.state);
								const hoveredPosition = handleNodePosRef.current;
								const isMulti =
									selected.length > 1 &&
									hoveredPosition != null &&
									selected.includes(hoveredPosition);
								if (isMulti) {
									const sorted = [...selected].sort((first, second) => first - second);
									multiBlockDragRef.current = sorted;
									dragPreviewPositionsRef.current = sorted;
									if (event.dataTransfer) {
										event.dataTransfer.effectAllowed = 'move';
									}
								} else {
									multiBlockDragRef.current = null;
									dragPreviewPositionsRef.current =
										hoveredPosition != null ? [hoveredPosition] : null;
									if (selected.length > 0) {
										editor.view.dispatch(
											editor.state.tr.setMeta(blockSelectionPluginKey, {
												blocks: [],
												anchor: null,
											}),
										);
									}
								}
							}}
							onElementDragEnd={() => {
								multiBlockDragRef.current = null;
								dragPreviewPositionsRef.current = null;
							}}
						>
							{handleNodeType === 'chartBlock' || handleNodeType === 'tableBlock' ? null : (
								<div className='drag-handle-button'>
									<GripVertical className='size-4' />
								</div>
							)}
						</DragHandle>
					)}
					<EditorContent editor={editor} />
				</div>
			</StoryBlockDragContext.Provider>
		</GridDragContext.Provider>
	);
});

export function getEditorMarkdown(editor: Editor): string {
	return editor.getMarkdown();
}
