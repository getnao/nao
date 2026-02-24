import { useEffect, useRef, useState } from 'react';
import { useResizeObserver } from './use-resize-observer';
import { loadPersistedWidthRatio, SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_WIDTH_STORAGE_KEY } from '@/lib/side-panel';

function persistRatio(ratio: number) {
	try {
		localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(ratio));
	} catch {
		/* localStorage unavailable */
	}
}

/** Handles the manual resize of the side panel */
export const useSidePanelResize = (
	sidePanelRef: React.RefObject<HTMLDivElement | null>,
	containerRef: React.RefObject<HTMLDivElement | null>,
	resizeHandleRef: React.RefObject<HTMLDivElement | null>,
	enabled: boolean,
) => {
	const ratioRef = useRef(loadPersistedWidthRatio());
	const [isResizing, setIsResizing] = useState(false);
	const resizeStartXRef = useRef(0);
	const resizeStartWidthRef = useRef(0);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const resizeHandle = resizeHandleRef.current;
		const sidePanel = sidePanelRef.current;
		if (!resizeHandle || !sidePanel) {
			return;
		}

		const handleMouseDown = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsResizing(true);

			resizeStartXRef.current = e.clientX;
			resizeStartWidthRef.current = sidePanel.getBoundingClientRect().width || 0;

			document.body.style.cursor = 'ew-resize';
		};

		resizeHandle.addEventListener('mousedown', handleMouseDown);
		return () => {
			resizeHandle.removeEventListener('mousedown', handleMouseDown);
		};
	}, [enabled, sidePanelRef, resizeHandleRef]);

	useEffect(() => {
		if (!isResizing) {
			return;
		}

		const handleMouseMove = (e: MouseEvent) => {
			const sidePanel = sidePanelRef.current;
			if (!sidePanel) {
				return;
			}

			const deltaX = e.clientX - resizeStartXRef.current;
			const width = resizeStartWidthRef.current - deltaX;
			sidePanel.style.transitionDuration = '0ms';
			sidePanel.style.width = `${width}px`;
		};

		const handleMouseUp = () => {
			setIsResizing(false);
			document.body.style.cursor = 'default';

			const sidePanel = sidePanelRef.current;
			const container = containerRef.current;
			if (sidePanel && container) {
				const sidePanelWidth = sidePanel.getBoundingClientRect().width;
				const containerWidth = container.getBoundingClientRect().width;
				ratioRef.current = sidePanelWidth / containerWidth;
				persistRatio(ratioRef.current);
			}
		};

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	}, [isResizing, sidePanelRef, containerRef]);

	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	useResizeObserver(containerRef, () => {
		if (!enabledRef.current) {
			return;
		}

		const container = containerRef.current;
		const sidePanel = sidePanelRef.current;
		if (!container || !sidePanel) {
			return;
		}

		const containerWidth = container.getBoundingClientRect().width;
		const width = Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(ratioRef.current * containerWidth));
		sidePanel.style.width = `${width}px`;
		sidePanel.style.transitionDuration = '0ms';
	});

	return { isResizing, ratioRef };
};
