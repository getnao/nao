import {
	insertGridColumn,
	parseChartAttributes,
	parseGridColumns,
	previewGridColumns,
	reorderGridColumns,
	resizeGridColumns,
	resolveGridWidths,
	setGridColumnsMarkup,
	splitGridColumnsRaw,
} from '@nao/shared/story-segments';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { removeCardFromOrigin } from '../story-editor-utils';
import {
	GRID_COLUMN_DRAG_TYPE,
	GridDragContext,
	STORY_BLOCK_DRAG_TYPE,
	StoryBlockDragContext,
} from '../story-editor-drag-context';
import type { Segment } from '@nao/shared/story-segments';
import type { ReactNodeViewProps } from '@tiptap/react';
import type {
	DragEvent as ReactDragEvent,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from 'react';
import { replaceUniqueStoryBlockTag } from '@/contexts/story-chart-edit-utils';

interface GridResizeDrag {
	boundaryIndex: number;
	contentLeft: number;
	contentWidth: number;
	gapWidth: number;
	targetFraction: number;
	widths: number[];
}

function getResizeTargetFraction(drag: GridResizeDrag, clientX: number): number {
	const gapOffset = drag.boundaryIndex * drag.gapWidth + drag.gapWidth / 2;
	const pointerX = clientX - drag.contentLeft - gapOffset;
	return Math.min(Math.max(pointerX / drag.contentWidth, 0), 1);
}

/**
 * Encapsulates all interaction state for the grid block editor node: column
 * drag/drop reordering, external block insertion, and column resizing.
 */
export function useStoryEditorGridBlock({ node, updateAttributes, getPos, editor }: ReactNodeViewProps) {
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
			cols: parseInt(attrs.cols || String(children.length || 1), 10),
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

	return {
		gridRef,
		segments,
		cols,
		visualWidths,
		activeBoundary,
		resizeHandlePositions,
		dropIndicatorLeft,
		externalBlockActive,
		handleReplaceTag,
		clearDrag,
		handleColumnDragStart,
		handleGridDragOver,
		handleGridDrop,
		insertExternalStoryBlock,
		handleResizeStart,
		updateResize,
		finishResize,
		handleResizeKeyDown,
		setBlockDropIndex,
	};
}
