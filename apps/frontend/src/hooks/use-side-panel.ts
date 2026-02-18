import { useCallback, useEffect, useRef, useState } from 'react';

import { useParams } from '@tanstack/react-router';
import { useSidebar } from '@/contexts/sidebar';
import {
	SIDEBAR_DELTA,
	SIDE_PANEL_ANIMATION_DURATION,
	SIDE_PANEL_DEFAULT_WIDTH_RATIO,
	SIDE_PANEL_MIN_WIDTH,
} from '@/lib/side-panel';

export const useSidePanel = ({
	containerRef,
	sidePanelRef,
}: {
	containerRef: React.RefObject<HTMLDivElement | null>;
	sidePanelRef: React.RefObject<HTMLDivElement | null>;
}) => {
	const didCollapseSidebarRef = useRef(false);
	const resizeHandleRef = useRef<HTMLDivElement>(null);

	const [content, setContent] = useState<React.ReactNode>(null);

	const [isVisible, setIsVisible] = useState(false);
	const [isAnimating, setIsAnimating] = useState(false);

	const removeTransitionEndEventListener = useRef<(() => void) | null>(null);

	const { collapse: collapseSidebar, expand: expandSidebar, isCollapsed: isSidebarCollapsed } = useSidebar();

	const chatId = useParams({ strict: false, select: (params) => params.chatId });

	const animateSidePanel = useCallback(
		({ onComplete, ...style }: { onComplete?: () => void } & React.CSSProperties) => {
			const sidePanel = sidePanelRef.current;
			if (!sidePanel) {
				return;
			}

			removeTransitionEndEventListener.current?.();
			removeTransitionEndEventListener.current = null;

			setIsAnimating(true);

			sidePanel.style.minWidth = '0px';
			sidePanel.style.transitionProperty = 'width, opacity';
			sidePanel.style.transitionTimingFunction = 'cubic-bezier(0.5, 0.5, 0, 1)';
			sidePanel.style.transitionDuration = `${SIDE_PANEL_ANIMATION_DURATION}ms`;

			const handleTransitionEnd = (e: TransitionEvent) => {
				if (e.target !== sidePanel) {
					return;
				}
				setIsAnimating(false);
				onComplete?.();
				removeTransitionEndEventListener.current?.();
			};

			sidePanel.addEventListener('transitionend', handleTransitionEnd);

			removeTransitionEndEventListener.current = () => {
				sidePanel.removeEventListener('transitionend', handleTransitionEnd);
			};

			requestAnimationFrame(() => {
				Object.assign(sidePanel.style, style);
			});
		},
		[sidePanelRef],
	);

	// Animate the side panel when opened
	useEffect(() => {
		if (!isVisible) {
			return;
		}

		const sidePanel = sidePanelRef.current;
		const container = containerRef.current;
		if (!sidePanel || !container) {
			return;
		}

		sidePanel.style.width = '0px';
		sidePanel.style.opacity = '0';

		const containerWidth =
			container.getBoundingClientRect().width + (didCollapseSidebarRef.current ? SIDEBAR_DELTA : 0);
		const targetWidth = Math.floor(SIDE_PANEL_DEFAULT_WIDTH_RATIO * containerWidth);

		animateSidePanel({
			width: `${targetWidth}px`,
			opacity: '1',
			onComplete: () => {
				sidePanel.style.minWidth = `${SIDE_PANEL_MIN_WIDTH}px`;
			},
		});
	}, [isVisible, animateSidePanel, containerRef, sidePanelRef]);

	const open = useCallback(
		(newContent: React.ReactNode) => {
			setIsVisible(true);
			setContent(newContent);
			didCollapseSidebarRef.current = !isSidebarCollapsed;
			collapseSidebar({ persist: false });
		},
		[collapseSidebar, isSidebarCollapsed],
	);

	const expandSidebarIfWasCollapsed = useCallback(() => {
		if (didCollapseSidebarRef.current) {
			expandSidebar({ persist: false });
			didCollapseSidebarRef.current = false;
		}
	}, [expandSidebar]);

	const close = useCallback(() => {
		expandSidebarIfWasCollapsed();
		animateSidePanel({
			width: '0px',
			opacity: '0',
			onComplete: () => {
				setIsVisible(false);
				setContent(null);
			},
		});
	}, [expandSidebarIfWasCollapsed, animateSidePanel]);

	useEffect(() => {
		expandSidebarIfWasCollapsed();
		setIsVisible(false);
		setContent(null);
	}, [chatId, expandSidebarIfWasCollapsed]);

	return {
		resizeHandleRef,
		isVisible,
		isAnimating,
		content,
		open,
		close,
	};
};
