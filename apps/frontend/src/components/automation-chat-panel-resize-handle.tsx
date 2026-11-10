import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';

const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 800;
const KEYBOARD_STEP = 16;
/** Dragged narrower than this, the panel closes; a closed panel dragged wider than this opens. */
const COLLAPSE_THRESHOLD = MIN_PANEL_WIDTH / 2;

const panelWidthStorage = createLocalStorage<number>('nao-automation-chat-panel-width', DEFAULT_PANEL_WIDTH);

interface PanelWidth {
	width: number;
	setWidth: (width: number, options?: { persist?: boolean }) => void;
}

interface PanelOpenState {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
}

type DragState = { startX: number; startWidth: number; width: number; isOpen: boolean };

/** The width of the automation chat panel, remembered across automations. */
export function useAutomationChatPanelWidth(): PanelWidth {
	const [width, setWidth] = useLocalStorage(panelWidthStorage);
	return { width: clampPanelWidth(width), setWidth };
}

/**
 * Dragging the left edge of the panel resizes it, saved once released. Dragging a closed panel's edge
 * opens it, and dragging an open panel close to nothing closes it. Once focused, the arrow keys, Home and
 * End resize it; a double click or Enter brings back its default width, or opens a closed panel.
 *
 * The drag is followed on the window: opening or closing the panel replaces the element holding this handle.
 */
export function AutomationChatPanelResizeHandle({
	width,
	setWidth,
	isOpen,
	onOpenChange,
}: PanelWidth & PanelOpenState) {
	const dragRef = useRef<DragState | null>(null);

	const followDrag = (event: PointerEvent) => {
		const drag = dragRef.current;
		if (!drag) {
			return;
		}
		const draggedWidth = drag.startWidth - (event.clientX - drag.startX);
		const shouldBeOpen = draggedWidth >= COLLAPSE_THRESHOLD;
		if (shouldBeOpen !== drag.isOpen) {
			drag.isOpen = shouldBeOpen;
			onOpenChange(shouldBeOpen);
		}
		if (shouldBeOpen) {
			drag.width = clampPanelWidth(draggedWidth);
			setWidth(drag.width, { persist: false });
		}
	};

	const endDrag = () => {
		const drag = dragRef.current;
		dragRef.current = null;
		window.removeEventListener('pointermove', followDrag);
		window.removeEventListener('pointerup', endDrag);
		window.removeEventListener('pointercancel', endDrag);
		document.body.style.removeProperty('cursor');
		if (drag?.isOpen) {
			setWidth(drag.width);
		}
	};

	const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		dragRef.current = { startX: event.clientX, startWidth: isOpen ? width : 0, width, isOpen };
		document.body.style.cursor = 'col-resize';
		window.addEventListener('pointermove', followDrag);
		window.addEventListener('pointerup', endDrag);
		window.addEventListener('pointercancel', endDrag);
	};

	const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!isOpen) {
			if (event.key === 'ArrowLeft' || event.key === 'Enter') {
				event.preventDefault();
				onOpenChange(true);
			}
			return;
		}
		const nextWidth = getKeyboardWidth(event.key, width);
		if (nextWidth !== null) {
			event.preventDefault();
			setWidth(nextWidth);
		}
	};

	const resetOrOpen = () => {
		if (isOpen) {
			setWidth(DEFAULT_PANEL_WIDTH);
		} else {
			onOpenChange(true);
		}
	};

	return (
		<div
			role='separator'
			aria-orientation='vertical'
			aria-label={isOpen ? 'Resize the chat' : 'Drag to open the chat'}
			aria-valuenow={isOpen ? width : 0}
			aria-valuemin={MIN_PANEL_WIDTH}
			aria-valuemax={MAX_PANEL_WIDTH}
			tabIndex={0}
			className='absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none transition-colors outline-none hover:bg-primary/20 focus-visible:bg-primary/40'
			onKeyDown={resizeWithKeyboard}
			onPointerDown={startDrag}
			onDoubleClick={resetOrOpen}
		/>
	);
}

/** The panel sits on the right: moving its edge left widens it. */
function getKeyboardWidth(key: string, width: number): number | null {
	switch (key) {
		case 'ArrowLeft':
			return clampPanelWidth(width + KEYBOARD_STEP);
		case 'ArrowRight':
			return clampPanelWidth(width - KEYBOARD_STEP);
		case 'Home':
			return MIN_PANEL_WIDTH;
		case 'End':
			return MAX_PANEL_WIDTH;
		case 'Enter':
			return DEFAULT_PANEL_WIDTH;
		default:
			return null;
	}
}

function clampPanelWidth(width: number): number {
	return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}
