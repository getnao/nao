import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CitationData } from '@nao/shared/types';
import type { Chat } from '@/queries/use-chat-query';
import type { ResolvedStory } from '@/hooks/use-mentioned-stories';
import { useOptionalSelection } from '@/contexts/text-selection';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatId } from '@/hooks/use-chat-id';
import { useOpenMentionedStory } from '@/hooks/use-mentioned-stories';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { isCodeCitation } from '@/lib/citation-mention';
import { findQuotedRange } from '@/lib/selection-dom.utils';
import { requestCitedStoryElement } from '@/stores/cited-story-element';
import { requestCodeReveal } from '@/stores/code-reveal';
import { requestStoryHighlight } from '@/stores/story-highlight';
import { trpc } from '@/main';

/**
 * Shows what a citation points at: its story in the side panel, scrolled to the quoted text,
 * the cited element of a custom story outlined in its frame, or the cited lines in the story's code view.
 */
export function useOpenCitation() {
	const selectionCtx = useOptionalSelection();
	const sidePanel = useSidePanel();
	const chatId = useChatId();
	const questionStory = useQuickQuestionStory(chatId, !sidePanel.isReplay);
	const openStoryInSidePanel = useCallback(
		(story: { chatId: string; slug: string }) =>
			sidePanel.open(<StoryViewer chatId={story.chatId} storySlug={story.slug} />, story.slug),
		[sidePanel],
	);
	const openQuestionStory = useOpenMentionedStory(openStoryInSidePanel);

	return useCallback(
		(citation: CitationData) => {
			const { start, end, text, storySlug, block } = citation;
			const storyChatId = citation.storyChatId ?? chatId;
			requestCitedStoryElement(citation);
			const pageContainer = selectionCtx?.pageContainerRef.current;
			const revealInQuestionStory = (story: ResolvedStory) => {
				if (!isStoryShown(story, sidePanel)) {
					openQuestionStory(story);
				}
				revealInStory(citation);
			};
			if (questionStory && storySlug === questionStory.slug) {
				if (!block && pageContainer && isStoryPage(questionStory, sidePanel)) {
					showNowOrRetry(() => highlightQuoteIn([pageContainer], citation));
					return;
				}
				revealInQuestionStory(questionStory);
				return;
			}
			if (block) {
				if (storySlug && storyChatId && sidePanel.currentStorySlug !== storySlug) {
					sidePanel.open(<StoryViewer chatId={storyChatId} storySlug={storySlug} />, storySlug);
				}
				revealInStory(citation);
				return;
			}
			if (storySlug && storyChatId) {
				if (sidePanel.currentStorySlug === storySlug) {
					showNowOrRetry(() => scrollToStoryText(start, end, text));
					return;
				}

				sidePanel.open(<StoryViewer chatId={storyChatId} storySlug={storySlug} />, storySlug);
				retryUntilShown(() => scrollToStoryText(start, end, text));
				return;
			}

			const isQuoteShown = highlightQuoteIn(
				[
					selectionCtx?.containerRef.current,
					pageContainer,
					document.querySelector<HTMLElement>('[data-selection-container]'),
				],
				citation,
			);
			if (!isQuoteShown && questionStory && !storySlug) {
				revealInQuestionStory(questionStory);
			}
		},
		[selectionCtx, sidePanel, chatId, questionStory, openQuestionStory],
	);
}

/** The story a quick question is about: it lives in its own chat, not in the chat of the question. */
function useQuickQuestionStory(chatId: string | undefined, isEnabled: boolean): ResolvedStory | undefined {
	const questionStoryId = useQuery({
		...trpc.chat.get.queryOptions({ chatId: chatId ?? '' }),
		enabled: Boolean(chatId) && isEnabled,
		select: selectQuestionStoryId,
	}).data;
	return useQuery({
		...trpc.story.resolve.queryOptions({ storyId: questionStoryId ?? '' }),
		enabled: Boolean(questionStoryId),
		retry: false,
	}).data;
}

function selectQuestionStoryId(chat: Chat): string | undefined {
	return chat.forkMetadata?.type === 'story_question' ? chat.forkMetadata.id : undefined;
}

type SidePanelState = { chatId: string | null; currentStorySlug: string | null; isVisible: boolean };

/** On the story page, the quick question is asked beside the story itself. */
function isStoryPage(story: ResolvedStory, sidePanel: SidePanelState): boolean {
	return !sidePanel.chatId || sidePanel.chatId === story.chatId;
}

function isStoryShown(story: ResolvedStory, sidePanel: SidePanelState): boolean {
	return isStoryPage(story, sidePanel) || (sidePanel.isVisible && sidePanel.currentStorySlug === story.slug);
}

function highlightQuoteIn(containers: (Element | null | undefined)[], { start, end, text }: CitationData): boolean {
	for (const container of new Set(containers)) {
		const range = container ? findQuotedRange(container, start, end, text) : null;
		if (range) {
			highlightRange(range);
			return true;
		}
	}
	return false;
}

function revealInStory(citation: CitationData) {
	if (isCodeCitation(citation)) {
		requestCodeReveal(citation);
		return;
	}
	if (citation.block) {
		requestStoryHighlight(citation);
		return;
	}
	retryUntilShown(() => scrollToStoryText(citation.start, citation.end, citation.text));
}

/** A quote of a tab not shown yet appears once its tab is selected, so it is searched again until then. */
function showNowOrRetry(show: () => boolean) {
	if (!show()) {
		retryUntilShown(show);
	}
}

function retryUntilShown(show: () => boolean) {
	let attempts = 0;
	const MAX_ATTEMPTS = 20;

	const tryScroll = () => {
		if (show()) {
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
