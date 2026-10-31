import type { StoryBlockReference } from '@nao/shared/types';
import type { StoryElementAsk } from '@nao/shared/story-app';

export const BLOCK_SELECTOR = '[data-nao-block-kind]';
export const TEXT_REFERENCE: StoryBlockReference = { kind: 'text' };

const TEXT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
const MAX_QUOTE_LENGTH = 1000;

/** The block under the pointer, else the text block holding it: what a click in selection mode quotes. */
export function findInspectableElement(target: EventTarget | null): Element | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const element = target.closest(BLOCK_SELECTOR) ?? target.closest(TEXT_SELECTOR);
	return element && element.textContent?.trim() ? element : null;
}

export function describeElement(element: Element): StoryElementAsk {
	if (element.matches(BLOCK_SELECTOR)) {
		const block = readBlockReference(element as HTMLElement);
		return { block, text: block.title ?? '' };
	}
	return { block: TEXT_REFERENCE, text: toQuote(element.textContent ?? '') };
}

export function readBlockReference(element: HTMLElement): StoryBlockReference {
	const { naoBlockKind, naoBlockTitle, naoBlockQuery } = element.dataset;
	return { kind: naoBlockKind ?? 'block', title: naoBlockTitle, queryId: naoBlockQuery };
}

export function toQuote(text: string): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length > MAX_QUOTE_LENGTH ? `${normalized.slice(0, MAX_QUOTE_LENGTH)}…` : normalized;
}
