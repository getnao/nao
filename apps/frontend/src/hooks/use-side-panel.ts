import { createElement, Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { useParams } from '@tanstack/react-router';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useSidebar } from '@/contexts/sidebar';
import {
	CHAT_PANEL_MIN_WIDTH,
	SIDEBAR_DELTA,
	SIDE_PANEL_ANIMATION_DURATION,
	SIDE_PANEL_ANIMATION_EASING,
	SIDE_PANEL_MIN_WIDTH,
	loadPersistedWidthRatio,
} from '@/lib/side-panel';

export const useSidePanel = ({
	containerRef,
	sidePanelRef,
	defaultWidthRatio,
	shouldCollapseSidebar = true,
}: {
	containerRef: React.RefObject<HTMLDivElement | null>;
	sidePanelRef: React.RefObject<HTMLDivElement | null>;
	defaultWidthRatio?: number;
	shouldCollapseSidebar?: boolean;
}) => {
	const didCollapseSidebarRef = useRef(false);
	const resizeHandleRef = useRef<HTMLDivElement>(null);

	const [content, setContent] = useState<React.ReactNode>(null);
	const [currentStorySlug, setCurrentStorySlug] = useState<string | null>(null);
	const [currentStoryTabIndex, setCurrentStoryTabIndex] = useState(0);

	const contentEpochRef = useRef(0);

	const [isVisible, setIsVisible] = useState(false);
	const [isAnimating, setIsAnimating] = useState(false);

	const removeTransitionEndEventListener = useRef<(() => void) | null>(null);

	const isMobile = useIsMobile();
	const { collapse: collapseSidebar, expand: expandSidebar, isCollapsed: isSidebarCollapsed } = useSidebar();

	const routeKey = useParams({
		strict: false,
		select: (params) => params.chatId ?? params.shareId ?? params.storyId,
	});

	const animateSidePanel = useCallback(
		({
			onComplete,
			contentWidth,
			...style
		}: { onComplete?: () => void; contentWidth: number } & React.CSSProperties) => {
			const sidePanel = sidePanelRef.current;
			if (!sidePanel) {
				return;
			}

			removeTransitionEndEventListener.current?.();
			removeTransitionEndEventListener.current = null;

			setIsAnimating(true);

			freezeContentWidth(sidePanel, contentWidth);
			sidePanel.style.minWidth = '0px';
			sidePanel.style.transitionProperty = 'width, opacity';
			sidePanel.style.transitionTimingFunction = SIDE_PANEL_ANIMATION_EASING;
			sidePanel.style.transitionDuration = `${SIDE_PANEL_ANIMATION_DURATION}ms`;

			const handleTransitionEnd = (e: TransitionEvent) => {
				if (e.target !== sidePanel) {
					return;
				}
				setIsAnimating(false);
				releaseContentWidth(sidePanel);
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

		if (isMobile) {
			return;
		}

		sidePanel.style.width = '0px';
		sidePanel.style.opacity = '0';

		const sidebarDelta = shouldCollapseSidebar && didCollapseSidebarRef.current ? SIDEBAR_DELTA : 0;
		const containerWidth = container.getBoundingClientRect().width + sidebarDelta;
		const ratio = resolveWidthRatio(defaultWidthRatio);
		const targetWidth = Math.floor(ratio * containerWidth);

		animateSidePanel({
			width: `${targetWidth}px`,
			opacity: '1',
			contentWidth: targetWidth,
			onComplete: () => {
				sidePanel.style.minWidth = `${SIDE_PANEL_MIN_WIDTH}px`;
			},
		});
	}, [isVisible, isMobile, animateSidePanel, containerRef, sidePanelRef, defaultWidthRatio, shouldCollapseSidebar]);

	const open = useCallback(
		(newContent: React.ReactNode, storySlug?: string) => {
			contentEpochRef.current += 1;
			setIsVisible(true);
			setContent(createElement(Fragment, { key: contentEpochRef.current }, newContent));
			setCurrentStorySlug(storySlug ?? null);
			setCurrentStoryTabIndex(0);
			const widthRatio = resolveWidthRatio(defaultWidthRatio);
			const isTooNarrow = !hasRoomForSidePanel(containerRef.current, widthRatio);
			if (!isMobile && shouldCollapseSidebar && !isSidebarCollapsed && isTooNarrow) {
				didCollapseSidebarRef.current = true;
				collapseSidebar({ persist: false });
			}
		},
		[isMobile, shouldCollapseSidebar, collapseSidebar, isSidebarCollapsed, containerRef, defaultWidthRatio],
	);

	const expandSidebarIfWasCollapsed = useCallback(() => {
		if (didCollapseSidebarRef.current) {
			expandSidebar({ persist: false });
			didCollapseSidebarRef.current = false;
		}
	}, [expandSidebar]);

	const close = useCallback(() => {
		setIsVisible(false);
		setCurrentStorySlug(null);
		setCurrentStoryTabIndex(0);
		if (isMobile) {
			setContent(null);
		} else {
			expandSidebarIfWasCollapsed();
			animateSidePanel({
				width: '0px',
				opacity: '0',
				contentWidth: getContentWidth(sidePanelRef.current),
				onComplete: () => setContent(null),
			});
		}
	}, [isMobile, expandSidebarIfWasCollapsed, animateSidePanel, sidePanelRef]);

	useEffect(() => {
		expandSidebarIfWasCollapsed();
		setIsVisible(false);
		setContent(null);
		setCurrentStorySlug(null);
		setCurrentStoryTabIndex(0);
	}, [routeKey, expandSidebarIfWasCollapsed]);

	return {
		resizeHandleRef,
		isVisible,
		isAnimating,
		content,
		currentStorySlug,
		setCurrentStorySlug,
		currentStoryTabIndex,
		setCurrentStoryTabIndex,
		open,
		close,
	};
};

function resolveWidthRatio(defaultWidthRatio: number | undefined): number {
	return defaultWidthRatio ?? loadPersistedWidthRatio();
}

/** Whether the side panel and the chat both fit at their minimum widths beside the expanded sidebar. */
function hasRoomForSidePanel(container: HTMLElement | null, widthRatio: number): boolean {
	if (!container) {
		return true;
	}
	const containerWidth = container.getBoundingClientRect().width;
	const sidePanelWidth = Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(widthRatio * containerWidth));
	return containerWidth - sidePanelWidth >= CHAT_PANEL_MIN_WIDTH;
}

/** Keeps the panel content at a fixed width while the panel animates, so it slides instead of reflowing every frame. */
function freezeContentWidth(sidePanel: HTMLDivElement, width: number) {
	const content = sidePanel.firstElementChild;
	if (!(content instanceof HTMLElement)) {
		return;
	}
	sidePanel.style.overflow = 'hidden';
	content.style.width = `${width}px`;
}

function releaseContentWidth(sidePanel: HTMLDivElement) {
	const content = sidePanel.firstElementChild;
	if (!(content instanceof HTMLElement)) {
		return;
	}
	sidePanel.style.overflow = '';
	content.style.width = '';
}

function getContentWidth(sidePanel: HTMLDivElement | null): number {
	return sidePanel?.firstElementChild?.getBoundingClientRect().width ?? 0;
}
