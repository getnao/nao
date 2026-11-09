import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';

const AUTO_MIN_HEIGHT = 160;
const AUTO_MAX_HEIGHT = 384;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 800;
const KEYBOARD_STEP = 16;

const promptHeightStorage = createLocalStorage<number>('nao-automation-prompt-height');

export interface PromptHeight {
	/** A height the user dragged to, or null to grow with the content between the automatic bounds. */
	height: number | null;
	setHeight: (height: number | null, options?: { persist?: boolean }) => void;
}

export function useAutomationPromptHeight(): PromptHeight {
	const [height, setHeight] = useLocalStorage(promptHeightStorage);
	return { height: height === null ? null : clampHeight(height), setHeight };
}

export function getPromptHeightBounds(height: number | null): { minHeight: string; maxHeight: string } {
	if (height === null) {
		return { minHeight: `${AUTO_MIN_HEIGHT}px`, maxHeight: `${AUTO_MAX_HEIGHT}px` };
	}
	return { minHeight: `${height}px`, maxHeight: `${height}px` };
}

/**
 * Dragging the bottom edge of the prompt card resizes the editor, saved once released, as do the arrow keys,
 * Home and End once focused; a double click or Enter brings back the automatic height.
 */
export function AutomationPromptResizeHandle({
	height,
	setHeight,
	measureEditorHeight,
}: PromptHeight & { measureEditorHeight: () => number }) {
	const dragRef = useRef<{ startY: number; startHeight: number; height: number } | null>(null);

	const startDrag = (event: PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const startHeight = measureEditorHeight();
		dragRef.current = { startY: event.clientY, startHeight, height: startHeight };
	};

	const drag = (event: PointerEvent<HTMLDivElement>) => {
		const current = dragRef.current;
		if (!current) {
			return;
		}
		current.height = clampHeight(current.startHeight + event.clientY - current.startY);
		setHeight(current.height, { persist: false });
	};

	const endDrag = () => {
		if (dragRef.current) {
			setHeight(dragRef.current.height);
			dragRef.current = null;
		}
	};

	const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		const nextHeight = getKeyboardHeight(event.key, height ?? measureEditorHeight());
		if (nextHeight !== undefined) {
			event.preventDefault();
			setHeight(nextHeight);
		}
	};

	return (
		<div
			role='separator'
			aria-orientation='horizontal'
			aria-label='Resize the agent instructions'
			aria-valuenow={height ?? undefined}
			aria-valuemin={MIN_HEIGHT}
			aria-valuemax={MAX_HEIGHT}
			tabIndex={0}
			className='group/resize absolute inset-x-3 -bottom-1 z-10 flex h-2 cursor-row-resize touch-none items-center justify-center rounded-full outline-none'
			onKeyDown={resizeWithKeyboard}
			onPointerDown={startDrag}
			onPointerMove={drag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onDoubleClick={() => setHeight(null)}
		>
			<span className='h-1 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover/prompt:opacity-100 group-hover/resize:bg-primary/40 group-focus-visible/resize:bg-primary/60 group-focus-visible/resize:opacity-100' />
		</div>
	);
}

function getKeyboardHeight(key: string, height: number): number | null | undefined {
	switch (key) {
		case 'ArrowUp':
			return clampHeight(height - KEYBOARD_STEP);
		case 'ArrowDown':
			return clampHeight(height + KEYBOARD_STEP);
		case 'Home':
			return MIN_HEIGHT;
		case 'End':
			return MAX_HEIGHT;
		case 'Enter':
			return null;
		default:
			return undefined;
	}
}

function clampHeight(height: number): number {
	return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
}
