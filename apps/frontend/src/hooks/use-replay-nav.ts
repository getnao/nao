import { useCallback, useEffect, useRef, useState } from 'react';

const HIGHLIGHT_CLASS = 'replay-nav-highlight';
const HIGHLIGHT_DURATION_MS = 2000;

export type ReplayNavType = 'feedback' | 'tool-error';

function getSortedElements(container: HTMLElement, type: ReplayNavType): HTMLElement[] {
	const raw = container.querySelectorAll<HTMLElement>(`[data-replay-nav="${type}"]`);
	return Array.from(raw).sort((a, b) => {
		const rectA = a.getBoundingClientRect();
		const rectB = b.getBoundingClientRect();
		return rectA.top - rectB.top;
	});
}

const SCROLL_REASSERT_ATTEMPTS = 6;
const SCROLL_REASSERT_INTERVAL_MS = 80;

export function scrollToElementInContainer(container: HTMLElement, target: HTMLElement, escapeLock?: () => void) {
	const scrollable = findScrollableAncestor(target, container);
	if (!scrollable) {
		return;
	}
	escapeLock?.();
	scrollable.scrollTo({ top: centeredTopFor(scrollable, target), behavior: 'smooth' });

	let attempts = 0;
	const reassert = () => {
		attempts += 1;
		escapeLock?.();
		const desired = centeredTopFor(scrollable, target);
		if (Math.abs(scrollable.scrollTop - desired) > 2) {
			scrollable.scrollTo({ top: desired, behavior: 'auto' });
		}
		if (attempts < SCROLL_REASSERT_ATTEMPTS) {
			window.setTimeout(reassert, SCROLL_REASSERT_INTERVAL_MS);
		}
	};
	window.setTimeout(reassert, SCROLL_REASSERT_INTERVAL_MS);
}

/** Opens a tool-error target so its error is readable immediately. */
export function expandReplayTarget(target: HTMLElement) {
	if (target.dataset.replayNav !== 'tool-error') {
		return;
	}
	const trigger = target.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
	trigger?.click();
}

function centeredTopFor(scrollable: HTMLElement, target: HTMLElement): number {
	const scrollableRect = scrollable.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const targetOffset = targetRect.top - scrollableRect.top + scrollable.scrollTop;
	return Math.max(0, targetOffset - scrollable.clientHeight / 2 + target.clientHeight / 2);
}

function findScrollableAncestor(el: HTMLElement, boundaryContainer: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = el.parentElement;
	while (current && current !== boundaryContainer) {
		const { overflowY } = getComputedStyle(current);
		if (overflowY === 'auto' || overflowY === 'scroll') {
			return current;
		}
		current = current.parentElement;
	}
	return boundaryContainer;
}

function findCurrentIndex(elements: HTMLElement[], highlighted: HTMLElement | null): number {
	if (!highlighted) {
		return -1;
	}
	const i = elements.indexOf(highlighted);
	return i >= 0 ? i : -1;
}

export function useReplayNav(
	scrollContainerRef: React.RefObject<HTMLElement | null>,
	contentReady: boolean,
	onEscapeStickLock?: () => void,
) {
	const feedbackIndexRef = useRef(-1);
	const toolErrorIndexRef = useRef(-1);
	const highlightedElementRef = useRef<HTMLElement | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const escapeStickLockRef = useRef(onEscapeStickLock);
	escapeStickLockRef.current = onEscapeStickLock;

	const [feedbackCurrent, setFeedbackCurrent] = useState(0);
	const [feedbackTotal, setFeedbackTotal] = useState(0);
	const [currentFeedbackVote, setCurrentFeedbackVote] = useState<'up' | 'down' | null>(null);
	const [toolErrorCurrent, setToolErrorCurrent] = useState(0);
	const [toolErrorTotal, setToolErrorTotal] = useState(0);

	useEffect(() => {
		if (!contentReady || !scrollContainerRef.current) {
			return;
		}
		const container = scrollContainerRef.current;
		const feedbackEls = getSortedElements(container, 'feedback');
		const toolErrorEls = getSortedElements(container, 'tool-error');
		setFeedbackTotal(feedbackEls.length);
		setToolErrorTotal(toolErrorEls.length);
		setFeedbackCurrent(feedbackEls.length + 1);
		setToolErrorCurrent(toolErrorEls.length + 1);
		setCurrentFeedbackVote(null);
		feedbackIndexRef.current = feedbackEls.length;
		toolErrorIndexRef.current = toolErrorEls.length;
	}, [contentReady, scrollContainerRef]);

	const clearHighlight = useCallback(() => {
		const container = scrollContainerRef.current;
		if (container) {
			container
				.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`)
				.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
		}
		highlightedElementRef.current = null;
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, [scrollContainerRef]);

	const highlightTarget = useCallback(
		(target: HTMLElement) => {
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}
			clearHighlight();
			expandReplayTarget(target);
			scrollToElementInContainer(container, target, escapeStickLockRef.current);
			target.classList.add(HIGHLIGHT_CLASS);
			highlightedElementRef.current = target;
			timeoutRef.current = setTimeout(() => {
				clearHighlight();
				timeoutRef.current = null;
			}, HIGHLIGHT_DURATION_MS);
		},
		[scrollContainerRef, clearHighlight],
	);

	const goTo = useCallback(
		(type: ReplayNavType, direction: 1 | -1) => {
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}

			const elements = getSortedElements(container, type);
			if (elements.length === 0) {
				const indexRef = type === 'feedback' ? feedbackIndexRef : toolErrorIndexRef;
				indexRef.current = -1;
				if (type === 'feedback') {
					setFeedbackCurrent(0);
					setFeedbackTotal(0);
				} else {
					setToolErrorCurrent(0);
					setToolErrorTotal(0);
				}
				return;
			}

			const indexRef = type === 'feedback' ? feedbackIndexRef : toolErrorIndexRef;
			const currentIndex =
				highlightedElementRef.current && elements.includes(highlightedElementRef.current)
					? findCurrentIndex(elements, highlightedElementRef.current)
					: indexRef.current;

			let nextIndex: number;
			if (direction === 1) {
				nextIndex = currentIndex < elements.length - 1 ? currentIndex + 1 : 0;
			} else {
				nextIndex = currentIndex <= 0 ? elements.length - 1 : currentIndex - 1;
			}
			indexRef.current = nextIndex;
			const target = elements[nextIndex];

			if (type === 'feedback') {
				setFeedbackCurrent(nextIndex + 1);
				setFeedbackTotal(elements.length);
				const vote = target.dataset.replayNavVote;
				setCurrentFeedbackVote(vote === 'up' || vote === 'down' ? vote : null);
			} else {
				setToolErrorCurrent(nextIndex + 1);
				setToolErrorTotal(elements.length);
			}

			highlightTarget(target);
		},
		[scrollContainerRef, highlightTarget],
	);

	const goToPrevFeedback = useCallback(() => goTo('feedback', -1), [goTo]);
	const goToNextFeedback = useCallback(() => goTo('feedback', 1), [goTo]);
	const goToPrevToolError = useCallback(() => goTo('tool-error', -1), [goTo]);
	const goToNextToolError = useCallback(() => goTo('tool-error', 1), [goTo]);

	return {
		highlightTarget,
		goToPrevFeedback,
		goToNextFeedback,
		goToPrevToolError,
		goToNextToolError,
		feedbackCurrent,
		feedbackTotal,
		currentFeedbackVote,
		toolErrorCurrent,
		toolErrorTotal,
	};
}
