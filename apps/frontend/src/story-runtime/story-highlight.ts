import { PART_SELECTOR, STORY_ELEMENT_BLOCK_KIND } from '@nao/shared/story-parts';
import { findSameBlocks, readElementPart } from './story-elements';
import type { StoryBlockPart } from '@nao/shared/story-parts';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { StoryBlockReference } from '@nao/shared/types';

/** Dispatched on a cited element before it is outlined; a container hiding it, like a deck, cancels it once shown. */
export const STORY_REVEAL_EVENT = 'nao-story:reveal';

const TEXT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,td,th,span,div';
const MAX_SEARCHED_QUOTE_LENGTH = 80;
const MIN_QUOTE_START_WORDS = 3;
const OUTLINE_DURATION_MS = 1800;
const MAX_WAIT_MS = 8000;
const PART_GRACE_MS = 1000;
const TOP_LAYER_Z_INDEX = 2147483646;
const PART_IDENTITY_FIELDS = ['label', 'series', 'category'] as const;
const ELEMENT_IDENTITY_FIELDS = [...PART_IDENTITY_FIELDS, 'value'] as const;
const OUTLINE_STYLE =
	'position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid var(--primary);border-radius:var(--story-block-radius, 6px);background:color-mix(in srgb, var(--primary) 8%, transparent);transition:opacity .3s';

interface CitedElementSearch {
	find: (settlesOnBlock: boolean) => Element | null;
	isBlockAwaitingPart: () => boolean;
}

interface HighlightOptions {
	root?: Element;
	zIndex?: number;
}

export function highlightStoryElement(
	ask: StoryElementAsk,
	{ root = document.body, zIndex = TOP_LAYER_Z_INDEX }: HighlightOptions = {},
): () => void {
	const show = (element: Element) => {
		if (!revealElement(element)) {
			element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		outline(element, zIndex);
	};
	const element = findCitedElement(ask, root, false);
	if (element) {
		show(element);
		return () => {};
	}
	return waitForElement(
		{
			find: (settlesOnBlock) => findCitedElement(ask, root, settlesOnBlock),
			isBlockAwaitingPart: () => findBlockAwaitingPart(ask, root) !== null,
		},
		root,
		show,
	);
}

function findCitedElement({ block, text }: StoryElementAsk, root: ParentNode, settlesOnBlock: boolean): Element | null {
	if (block.kind === 'text') {
		return findQuotedElement(text, root);
	}
	if (block.kind === STORY_ELEMENT_BLOCK_KIND) {
		return block.part ? findPart(block.part, root) : null;
	}
	const blockElement = findBlock(block, root);
	if (!blockElement) {
		return findQuotedElement(text, root);
	}
	if (!block.part) {
		return blockElement;
	}
	return findPart(block.part, blockElement) ?? (settlesOnBlock ? blockElement : null);
}

function findBlockAwaitingPart({ block }: StoryElementAsk, root: ParentNode): Element | null {
	if (block.kind === 'text' || block.kind === STORY_ELEMENT_BLOCK_KIND || !block.part) {
		return null;
	}
	return findBlock(block, root);
}

/** The part's grace period starts once its block is shown, as a block renders its parts only after its data loads. */
function waitForElement(
	{ find, isBlockAwaitingPart }: CitedElementSearch,
	root: Element,
	onFound: (element: Element) => void,
): () => void {
	let frame = 0;
	let grace = 0;
	let settlesOnBlock = false;
	const stop = () => {
		observer.disconnect();
		cancelAnimationFrame(frame);
		window.clearTimeout(timeout);
		window.clearTimeout(grace);
	};
	const startGraceOnceBlockShown = () => {
		if (!grace && isBlockAwaitingPart()) {
			grace = window.setTimeout(settleOnBlock, PART_GRACE_MS);
		}
	};
	const search = () => {
		frame = 0;
		const element = find(settlesOnBlock);
		if (element) {
			stop();
			onFound(element);
			return;
		}
		startGraceOnceBlockShown();
	};
	const settleOnBlock = () => {
		settlesOnBlock = true;
		cancelAnimationFrame(frame);
		search();
	};
	const observer = new MutationObserver(() => {
		if (!frame) {
			frame = requestAnimationFrame(search);
		}
	});
	const giveUp = () => {
		if (grace) {
			settleOnBlock();
		}
		stop();
	};
	const timeout = window.setTimeout(giveUp, MAX_WAIT_MS);
	observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
	startGraceOnceBlockShown();
	return stop;
}

/** Whether a container brought the element into view itself, so it needs no scrolling. */
function revealElement(element: Element): boolean {
	return !element.dispatchEvent(new Event(STORY_REVEAL_EVENT, { bubbles: true, cancelable: true }));
}

function findPart(cited: StoryBlockPart, block: ParentNode): Element | null {
	const parts = [...block.querySelectorAll(PART_SELECTOR)].map((element) => ({
		element,
		part: readElementPart(element),
	}));
	const exact = parts.find(({ part }) => isSamePart(cited, part, identityFields(cited)));
	const sameCell =
		cited.kind === 'cell' ? parts.find(({ part }) => isSamePart(cited, part, PART_IDENTITY_FIELDS)) : undefined;
	return (exact ?? sameCell)?.element ?? null;
}

function identityFields(cited: StoryBlockPart): readonly (keyof StoryBlockPart)[] {
	return cited.kind === 'element' || cited.kind === 'cell' ? ELEMENT_IDENTITY_FIELDS : PART_IDENTITY_FIELDS;
}

function isSamePart(
	cited: StoryBlockPart,
	found: StoryBlockPart | null,
	fields: readonly (keyof StoryBlockPart)[],
): boolean {
	return (
		found !== null &&
		found.kind === cited.kind &&
		fields.every((field) => cited[field] === undefined || cited[field] === found[field])
	);
}

function findBlock(block: StoryBlockReference, root: ParentNode): HTMLElement | null {
	return findSameBlocks(block, root)[block.occurrence ?? 0] ?? null;
}

/** The starts of a quote searched for it, longest first, as a passage may be cut by markup the quote lost. */
export function toQuoteStarts(text: string): string[] {
	const quote = normalize(text).replace(/…$/, '').slice(0, MAX_SEARCHED_QUOTE_LENGTH);
	const words = quote.split(' ').filter(Boolean);
	return words.map((_, dropped) => words.slice(0, words.length - dropped).join(' '));
}

/** The smallest, then deepest, element holding the start of the quote, so the outline hugs the passage. */
function findQuotedElement(text: string, root: ParentNode): HTMLElement | null {
	const starts = toQuoteStarts(text);
	for (const [index, start] of starts.entries()) {
		const isShortCut = index > 0 && start.split(' ').length < MIN_QUOTE_START_WORDS;
		const element = findSmallestElementHolding(root, (content) =>
			isShortCut ? content.endsWith(start) : content.includes(start),
		);
		if (element) {
			return element;
		}
	}
	return null;
}

function findSmallestElementHolding(root: ParentNode, holdsQuote: (content: string) => boolean): HTMLElement | null {
	let closest: HTMLElement | null = null;
	for (const element of root.querySelectorAll<HTMLElement>(TEXT_SELECTOR)) {
		const content = normalize(element.textContent ?? '');
		if (holdsQuote(content) && (!closest || content.length <= normalize(closest.textContent ?? '').length)) {
			closest = element;
		}
	}
	return closest;
}

/** Follows the element while it scrolls into view, then fades out. */
function outline(element: Element, zIndex: number): void {
	const box = document.createElement('div');
	box.setAttribute('style', OUTLINE_STYLE);
	box.style.zIndex = String(zIndex);
	document.body.append(box);
	const startedAt = performance.now();
	const follow = () => {
		const rect = element.getBoundingClientRect();
		Object.assign(box.style, {
			top: `${rect.top - 4}px`,
			left: `${rect.left - 4}px`,
			width: `${rect.width + 8}px`,
			height: `${rect.height + 8}px`,
		});
		if (performance.now() - startedAt < OUTLINE_DURATION_MS) {
			requestAnimationFrame(follow);
			return;
		}
		box.style.opacity = '0';
		window.setTimeout(() => box.remove(), 300);
	};
	follow();
}

function normalize(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}
