import { useEffect, useRef } from 'react';
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
	const rafRef = useRef(0);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const resizeHandle = resizeHandleRef.current;
		const sidePanel = sidePanelRef.current;
		if (!resizeHandle || !sidePanel) {
			return;
		}

		let startX = 0;
		let startWidth = 0;

		const handleMouseMove = (e: MouseEvent) => {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(() => {
				const deltaX = e.clientX - startX;
				const width = startWidth - deltaX;
				sidePanel.style.transitionDuration = '0ms';
				sidePanel.style.width = `${width}px`;
			});
		};

		const handleMouseUp = () => {
			cancelAnimationFrame(rafRef.current);
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.body.style.cursor = 'default';

			const container = containerRef.current;
			if (container) {
				const sidePanelWidth = sidePanel.getBoundingClientRect().width;
				const containerWidth = container.getBoundingClientRect().width;
				ratioRef.current = sidePanelWidth / containerWidth;
				persistRatio(ratioRef.current);
			}
		};

		const handleMouseDown = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			startX = e.clientX;
			startWidth = sidePanel.getBoundingClientRect().width || 0;
			document.body.style.cursor = 'ew-resize';
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		};

		resizeHandle.addEventListener('mousedown', handleMouseDown);
		return () => {
			resizeHandle.removeEventListener('mousedown', handleMouseDown);
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			cancelAnimationFrame(rafRef.current);
		};
	}, [enabled, sidePanelRef, containerRef, resizeHandleRef]);

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

	return { ratioRef };
};
