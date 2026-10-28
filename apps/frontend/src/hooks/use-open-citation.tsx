import { useCallback } from 'react';
import type { CitationData } from '@nao/shared/types';
import { useOptionalSelection } from '@/contexts/text-selection';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatId } from '@/hooks/use-chat-id';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { isCodeCitation } from '@/lib/citation-mention';
import { findQuotedRange } from '@/lib/selection-dom.utils';
import { requestStoryHighlight } from '@/stores/story-highlight';

/**
 * Shows what a citation points at: its story in the side panel, scrolled to the quoted text,
 * or the cited element of a custom story outlined in its frame.
 */
export function useOpenCitation() {
	const selectionCtx = useOptionalSelection();
	const sidePanel = useSidePanel();
	const chatId = useChatId();

	return useCallback(
		(citation: CitationData) => {
			const { start, end, text, storySlug, block } = citation;
			if (isCodeCitation(citation)) {
				return;
			}
			if (block) {
				if (storySlug && chatId && sidePanel.currentStorySlug !== storySlug) {
					sidePanel.open(<StoryViewer chatId={chatId} storySlug={storySlug} />, storySlug);
				}
				requestStoryHighlight(citation);
				return;
			}
			if (storySlug && chatId) {
				if (sidePanel.currentStorySlug === storySlug) {
					scrollToStoryText(start, end, text);
					return;
				}

				sidePanel.open(<StoryViewer chatId={chatId} storySlug={storySlug} />, storySlug);
				pollAndScrollToStoryText(start, end, text);
				return;
			}

			const container =
				selectionCtx?.containerRef.current ?? document.querySelector<HTMLElement>('[data-selection-container]');
			if (!container) {
				return;
			}

			const range = findQuotedRange(container, start, end, text);
			if (range) {
				highlightRange(range);
			}
		},
		[selectionCtx, sidePanel, chatId],
	);
}

function pollAndScrollToStoryText(start: number, end: number, text: string) {
	let attempts = 0;
	const MAX_ATTEMPTS = 20;

	const tryScroll = () => {
		if (scrollToStoryText(start, end, text)) {
			return;
		}
		attempts++;
		if (attempts < MAX_ATTEMPTS) {
			setTimeout(tryScroll, attempts < 5 ? 100 : 300);
		}
	};

	setTimeout(tryScroll, 100);
}

function scrollToStoryText(start: number, end: number, text: string): boolean {
	const container = document.querySelector('[data-story-content]');
	if (!container) {
		return false;
	}

	const range = findQuotedRange(container, start, end, text);
	if (!range) {
		return false;
	}

	highlightRange(range);
	return true;
}

function highlightRange(range: Range) {
	const ancestor = range.startContainer;
	const el = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : (ancestor as Element);
	if (el) {
		scrollToElement(el);
	}

	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
	setTimeout(() => sel?.removeAllRanges(), 2000);
}

function scrollToElement(el: Element) {
	const scrollParent = findScrollParent(el);
	if (scrollParent) {
		const rect = el.getBoundingClientRect();
		const parentRect = scrollParent.getBoundingClientRect();
		scrollParent.scrollTo({
			top: scrollParent.scrollTop + (rect.top - parentRect.top) - parentRect.height / 2,
			behavior: 'smooth',
		});
		return;
	}
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function findScrollParent(element: Element): Element | null {
	let current = element.parentElement;
	while (current) {
		const style = getComputedStyle(current);
		if (
			current.scrollHeight > current.clientHeight &&
			(style.overflowY === 'auto' || style.overflowY === 'scroll')
		) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}
