import { BLOCK_SELECTOR } from './story-elements';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { StoryBlockReference } from '@nao/shared/types';

/** Dispatched on a cited element before it is outlined; a container hiding it, like a deck, cancels it once shown. */
export const STORY_REVEAL_EVENT = 'nao-story:reveal';

const TEXT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,td,th,span,div';
const MAX_SEARCHED_QUOTE_LENGTH = 80;
const OUTLINE_DURATION_MS = 1800;
const MAX_WAIT_MS = 8000;
const TOP_LAYER_Z_INDEX = 2147483646;
const OUTLINE_STYLE =
	'position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid var(--primary);border-radius:var(--story-block-radius, 6px);background:color-mix(in srgb, var(--primary) 8%, transparent);transition:opacity .3s';

interface HighlightOptions {
	root?: Element;
	zIndex?: number;
}

export function highlightStoryElement(
	ask: StoryElementAsk,
	{ root = document.body, zIndex = TOP_LAYER_Z_INDEX }: HighlightOptions = {},
): () => void {
	const show = (element: HTMLElement) => {
		if (!revealElement(element)) {
			element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		outline(element, zIndex);
	};
	const element = findCitedElement(ask, root);
	if (element) {
		show(element);
		return () => {};
	}
	return waitForElement(() => findCitedElement(ask, root), root, show);
}

function findCitedElement({ block, text }: StoryElementAsk, root: ParentNode): HTMLElement | null {
	return block.kind === 'text'
		? findQuotedElement(text, root)
		: (findBlock(block, root) ?? findQuotedElement(text, root));
}

function waitForElement(
	find: () => HTMLElement | null,
	root: Element,
	onFound: (element: HTMLElement) => void,
): () => void {
	let frame = 0;
	const stop = () => {
		observer.disconnect();
		cancelAnimationFrame(frame);
		window.clearTimeout(timeout);
	};
	const search = () => {
		frame = 0;
		const element = find();
		if (element) {
			stop();
			onFound(element);
		}
	};
	const observer = new MutationObserver(() => {
		if (!frame) {
			frame = requestAnimationFrame(search);
		}
	});
	const timeout = window.setTimeout(stop, MAX_WAIT_MS);
	observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
	return stop;
}

/** Whether a container brought the element into view itself, so it needs no scrolling. */
function revealElement(element: HTMLElement): boolean {
	return !element.dispatchEvent(new Event(STORY_REVEAL_EVENT, { bubbles: true, cancelable: true }));
}

function findBlock({ kind, title, queryId }: StoryBlockReference, root: ParentNode): HTMLElement | null {
	const blocks = [...root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];
	return (
		blocks.find(
			({ dataset }) =>
				dataset.naoBlockKind === kind && dataset.naoBlockTitle === title && dataset.naoBlockQuery === queryId,
		) ?? null
	);
}

/** The smallest, then deepest, element holding the start of the quote, so the outline hugs the passage. */
function findQuotedElement(text: string, root: ParentNode): HTMLElement | null {
	const quote = normalize(text).replace(/…$/, '').slice(0, MAX_SEARCHED_QUOTE_LENGTH);
	for (const start of shorteningStarts(quote)) {
		const element = findSmallestElementHolding(start, root);
		if (element) {
			return element;
		}
	}
	return null;
}

function shorteningStarts(quote: string): string[] {
	const words = quote.split(' ').filter(Boolean);
	return words.map((_, dropped) => words.slice(0, words.length - dropped).join(' '));
}

function findSmallestElementHolding(quote: string, root: ParentNode): HTMLElement | null {
	let closest: HTMLElement | null = null;
	for (const element of root.querySelectorAll<HTMLElement>(TEXT_SELECTOR)) {
		const content = normalize(element.textContent ?? '');
		if (content.includes(quote) && (!closest || content.length <= normalize(closest.textContent ?? '').length)) {
			closest = element;
		}
	}
	return closest;
}

/** Follows the element while it scrolls into view, then fades out. */
function outline(element: HTMLElement, zIndex: number): void {
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
