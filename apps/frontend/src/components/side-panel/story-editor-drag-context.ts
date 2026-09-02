import { createContext } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DragOrigin, DragUnit } from './story-block-selection';

export const STORY_BLOCK_DRAG_TYPE = 'application/x-nao-story-block';
export const GRID_COLUMN_DRAG_TYPE = 'application/x-nao-grid-column';
export const STORY_TAB_DRAG_TYPE = 'application/x-nao-story-tab';

export function setStoryBlockDragOrigin(dataTransfer: DataTransfer, origin: DragOrigin): void {
	dataTransfer.setData(STORY_BLOCK_DRAG_TYPE, JSON.stringify(origin));
}

export function hasStoryBlockDrag(dataTransfer: DataTransfer): boolean {
	return dataTransfer.types.includes(STORY_BLOCK_DRAG_TYPE);
}

export function getStoryBlockDragOrigin(dataTransfer: DataTransfer): DragOrigin | null {
	if (!hasStoryBlockDrag(dataTransfer)) {
		return null;
	}

	try {
		const origin = JSON.parse(dataTransfer.getData(STORY_BLOCK_DRAG_TYPE)) as Partial<DragOrigin>;
		if (origin.kind === 'block' && Number.isInteger(origin.pos)) {
			return { kind: 'block', pos: origin.pos as number };
		}
		if (origin.kind === 'gridColumn' && Number.isInteger(origin.gridPos) && Number.isInteger(origin.index)) {
			return {
				kind: 'gridColumn',
				gridPos: origin.gridPos as number,
				index: origin.index as number,
			};
		}
	} catch {
		return null;
	}

	return null;
}

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
	isHandleTooltipSuppressed: boolean;
	suppressHandleTooltips: () => void;
	releaseHandleTooltipSuppression: () => void;
	activeDropZone: string | null;
	setActiveDropZone: Dispatch<SetStateAction<string | null>>;
	pendingDropRef: MutableRefObject<(() => void) | null>;
	beginMultiSelectionDrag: (units: DragUnit[], event: DragEvent) => void;
	endMultiSelectionDrag: () => void;
} | null>(null);

export const GridDragContext = createContext<MutableRefObject<GridDragSource | null> | null>(null);
