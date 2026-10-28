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
		const newOptions = options.filter((option) => !appendedIds.current.has(option.id));
		for (const option of newOptions) {
			promptRef.current?.appendMention(option, CITATION_MENTION_TRIGGER);
			appendedIds.current.add(option.id);
		}
		if (newOptions.length > 0) {
			requestAnimationFrame(() => promptRef.current?.focus());
		}
	}, [citations, options, promptRef]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const handleCopy = (event: ClipboardEvent) => {
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
		};
		container.addEventListener('copy', handleCopy);
		return () => container.removeEventListener('copy', handleCopy);
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
