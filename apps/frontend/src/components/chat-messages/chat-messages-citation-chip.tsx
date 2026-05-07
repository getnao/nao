import { useCallback, useRef } from 'react';
import { useOptionalSelection } from '@/contexts/text-selection';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatId } from '@/hooks/use-chat-id';
import { SelectionCitationExcerpt } from '@/components/selection-citation-excerpt';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { createRangeFromOffsets, findTextRange } from '@/lib/selection-dom.utils';

interface ChatMessagesCitationChipProps {
	start: number;
	end: number;
	text: string;
	storySlug?: string;
}

export const ChatMessagesCitationChip = ({ start, end, text, storySlug }: ChatMessagesCitationChipProps) => {
	const selectionCtx = useOptionalSelection();
	const sidePanel = useSidePanel();
	const chatId = useChatId();
	const buttonRef = useRef<HTMLButtonElement>(null);

	const handleClick = useCallback(() => {
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
			selectionCtx?.containerRef.current ?? buttonRef.current?.closest<HTMLElement>('[data-selection-container]');
		if (!container) {
			return;
		}

		const range = createRangeFromOffsets(container, start, end) ?? findTextRange(container, text);
		if (!range) {
			return;
		}

		highlightRange(range);
	}, [selectionCtx, sidePanel, chatId, storySlug, start, end, text]);

	return (
		<button
			ref={buttonRef}
			type='button'
			onClick={handleClick}
			className='mb-2 w-full text-left px-3 py-2 border border-border/50 bg-background/50 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors'
		>
			<SelectionCitationExcerpt start={start} end={end} text={text} maxLength={80} lineClamp={2} />
		</button>
	);
};

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

	const range = findStoryRange(container, start, end, text);
	if (!range) {
		return false;
	}

	highlightRange(range);
	return true;
}

function findStoryRange(container: Element, start: number, end: number, text: string): Range | null {
	return createRangeFromOffsets(container, start, end) ?? findTextRange(container, text);
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
