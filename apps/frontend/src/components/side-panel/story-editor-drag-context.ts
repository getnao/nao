import { createContext } from 'react';
import type { MutableRefObject } from 'react';

export const STORY_BLOCK_DRAG_TYPE = 'application/x-nao-story-block';
export const GRID_COLUMN_DRAG_TYPE = 'application/x-nao-grid-column';

export type CardOrigin = { kind: 'block'; pos: number } | { kind: 'gridColumn'; gridPos: number; columnIndex: number };

export type StoryBlockDragSource = {
	markup: string;
	origin: CardOrigin;
};

export type GridDragSource = {
	gridPos: number;
	columnIndex: number;
};

export type StoryBlockDropSide = 'left' | 'right';

export const StoryBlockDragContext = createContext<{
	sourceRef: MutableRefObject<StoryBlockDragSource | null>;
	isDragging: boolean;
	setDragging: (value: boolean) => void;
	beginMultiBlockDrag: (positions: number[], event: DragEvent) => void;
	endMultiBlockDrag: () => void;
} | null>(null);

export const GridDragContext = createContext<MutableRefObject<GridDragSource | null> | null>(null);
