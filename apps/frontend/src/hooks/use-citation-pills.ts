import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PromptHandle, SelectedMention } from 'prompt-mentions';
import type { RefObject } from 'react';
import type { PendingCitation } from '@/stores/chat-pending-citation';

import {
	CITATION_MENTION_TRIGGER,
	CITATION_PILL_SELECTOR,
	removeCitationPills,
	toCitationMentionOption,
	toCopiedText,
} from '@/lib/citation-mention';

interface CitationPillsOptions {
	promptRef: RefObject<PromptHandle | null>;
	containerRef: RefObject<HTMLElement | null>;
	citations: PendingCitation[];
	scope?: string;
	onRemove: (id: string) => void;
}

export function useCitationPills({ promptRef, containerRef, citations, scope, onRemove }: CitationPillsOptions) {
	const appendedIds = useRef(new Set<string>());
	const appendedScope = useRef(scope);
	const options = useMemo(
		() => citations.map((citation) => toCitationMentionOption(citation, citation.id)),
		[citations],
	);

	useEffect(() => {
		if (appendedScope.current === scope) {
			return;
		}
		appendedScope.current = scope;
		appendedIds.current.clear();
		if (containerRef.current) {
			removeCitationPills(containerRef.current);
		}
	}, [scope, containerRef]);

	useEffect(() => {
		const citedIds = new Set(citations.map((citation) => citation.id));
		for (const id of appendedIds.current) {
			if (!citedIds.has(id)) {
				appendedIds.current.delete(id);
			}
		}
		const shownIds = readShownPillIds(containerRef.current);
		const newOptions = options.filter((option) => !appendedIds.current.has(option.id));
		for (const option of newOptions) {
			if (!shownIds.has(option.id)) {
				promptRef.current?.appendMention(option, CITATION_MENTION_TRIGGER);
			}
			appendedIds.current.add(option.id);
		}
		if (newOptions.length > 0) {
			requestAnimationFrame(() => promptRef.current?.focus());
		}
	}, [citations, options, promptRef, containerRef]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const handleInput = () => {
			const shownIds = readShownPillIds(container);
			const goneIds = [...appendedIds.current].filter((id) => !shownIds.has(id));
			goneIds.forEach(onRemove);
		};
		container.addEventListener('input', handleInput);
		return () => container.removeEventListener('input', handleInput);
	}, [containerRef, onRemove]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const handleClipboard = (event: ClipboardEvent) => {
			const selection = document.getSelection();
			if (!selection || selection.isCollapsed || !event.clipboardData) {
				return;
			}
			const fragment = selection.getRangeAt(0).cloneContents();
			if (!fragment.querySelector(CITATION_PILL_SELECTOR)) {
				return;
			}
			const findCitation = (id: string) => citations.find((citation) => citation.id === id);
			event.clipboardData.setData('text/plain', toCopiedText(fragment, findCitation));
			event.preventDefault();
			event.stopPropagation();
			if (event.type === 'cut') {
				selection.deleteFromDocument();
				container.querySelector('.prompt-input')?.dispatchEvent(new Event('input', { bubbles: true }));
			}
		};
		container.addEventListener('copy', handleClipboard);
		container.addEventListener('cut', handleClipboard);
		return () => {
			container.removeEventListener('copy', handleClipboard);
			container.removeEventListener('cut', handleClipboard);
		};
	}, [containerRef, citations]);

	const handleMentionDeleted = useCallback(
		(mention: SelectedMention) => {
			if (mention.trigger === CITATION_MENTION_TRIGGER) {
				onRemove(mention.id);
			}
		},
		[onRemove],
	);

	return { options, handleMentionDeleted };
}

function readShownPillIds(container: HTMLElement | null): Set<string | undefined> {
	const pills = container?.querySelectorAll<HTMLElement>(CITATION_PILL_SELECTOR) ?? [];
	return new Set([...pills].map((pill) => pill.dataset.mentionId));
}
