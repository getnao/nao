import { useCallback, useEffect, useRef, useState } from 'react';

const HIGHLIGHT_CLASS = 'replay-nav-highlight';
const HIGHLIGHT_DURATION_MS = 2000;

export type ReplayNavType = 'feedback' | 'tool-error';

function getSortedElements(container: HTMLElement, type: ReplayNavType): HTMLElement[] {
	const raw = container.querySelectorAll<HTMLElement>(`[data-replay-nav="${type}"]`);
	return Array.from(raw).sort((a, b) => {
		const topA = a.getBoundingClientRect().top + container.scrollTop;
		const topB = b.getBoundingClientRect().top + container.scrollTop;
		return topA - topB;
	});
}

function findCurrentIndex(elements: HTMLElement[], highlighted: HTMLElement | null): number {
	if (!highlighted) {
		return -1;
	}
	const i = elements.indexOf(highlighted);
	return i >= 0 ? i : -1;
}

export function useReplayNav(scrollContainerRef: React.RefObject<HTMLElement | null>, contentReady: boolean) {
	const feedbackIndexRef = useRef(-1);
	const toolErrorIndexRef = useRef(-1);
	const highlightedElementRef = useRef<HTMLElement | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
		if (highlightedElementRef.current) {
			highlightedElementRef.current.classList.remove(HIGHLIGHT_CLASS);
			highlightedElementRef.current = null;
		}
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

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

			clearHighlight();
			target.scrollIntoView({ behavior: 'smooth', block: 'center' });
			target.classList.add(HIGHLIGHT_CLASS);
			highlightedElementRef.current = target;

			timeoutRef.current = setTimeout(() => {
				clearHighlight();
				timeoutRef.current = null;
			}, HIGHLIGHT_DURATION_MS);
		},
		[scrollContainerRef, clearHighlight],
	);

	const goToPrevFeedback = useCallback(() => goTo('feedback', -1), [goTo]);
	const goToNextFeedback = useCallback(() => goTo('feedback', 1), [goTo]);
	const goToPrevToolError = useCallback(() => goTo('tool-error', -1), [goTo]);
	const goToNextToolError = useCallback(() => goTo('tool-error', 1), [goTo]);

	return {
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
