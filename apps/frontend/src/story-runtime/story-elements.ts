import { PART_SELECTOR, readPart } from '@nao/shared/story-parts';
import type { StoryBlockReference } from '@nao/shared/types';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { StoryBlockPart } from '@nao/shared/story-parts';

export const BLOCK_SELECTOR = '[data-nao-block-kind]';
export const TEXT_REFERENCE: StoryBlockReference = { kind: 'text' };

const TEXT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
const MAX_QUOTE_LENGTH = 1000;
const MAX_PART_FIELD_LENGTH = 200;
const PART_FIELD_KEYS = ['naoPartLabel', 'naoPartSeries', 'naoPartCategory', 'naoPartValue'];
const QUOTED_BY_VALUE_KINDS: ReadonlySet<StoryBlockPart['kind']> = new Set(['kpi-value', 'kpi-comparison', 'cell']);

/** The part under the pointer inside a block, else the block, else the text block holding it: what a click in selection mode quotes. */
export function findInspectableElement(target: EventTarget | null): Element | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const part = target.closest(PART_SELECTOR);
	if (part && readElementPart(part)) {
		return part;
	}
	const element = target.closest(BLOCK_SELECTOR) ?? target.closest(TEXT_SELECTOR);
	return element && element.textContent?.trim() ? element : null;
}

export function describeElement(element: Element): StoryElementAsk {
	const part = readElementPart(element);
	if (part) {
		const block = readBlockReference(element.closest(BLOCK_SELECTOR)!);
		return { block: { ...block, part }, text: readPartQuote(part) ?? block.title ?? '' };
	}
	if (element.matches(BLOCK_SELECTOR)) {
		const block = readBlockReference(element);
		return { block, text: block.title ?? '' };
	}
	return { block: TEXT_REFERENCE, text: toQuote(element.textContent ?? '') };
}

export function readBlockReference(element: Element): StoryBlockReference {
	const { naoBlockKind, naoBlockTitle, naoBlockQuery } = (element as HTMLElement).dataset;
	return { kind: naoBlockKind ?? 'block', title: naoBlockTitle, queryId: naoBlockQuery };
}

export function toQuote(text: string): string {
	return truncate(text, MAX_QUOTE_LENGTH);
}

/** A data point or cell can have no text of its own: its category then identifies it. */
export function readElementPart(element: Element): StoryBlockPart | null {
	if (!element.closest(BLOCK_SELECTOR)) {
		return null;
	}
	const dataset = toPartDataset((element as HTMLElement).dataset);
	const part = readPart(dataset, toPartField(element.textContent ?? ''));
	if (part) {
		return part;
	}
	const identified = readPart(dataset, readIdentityFallback(dataset));
	return identified && withoutLabel(identified);
}

function toPartDataset(dataset: DOMStringMap): DOMStringMap {
	const normalized: DOMStringMap = { ...dataset };
	for (const key of PART_FIELD_KEYS) {
		if (normalized[key] !== undefined) {
			normalized[key] = toPartField(normalized[key]);
		}
	}
	return normalized;
}

function toPartField(text: string): string {
	return truncate(text, MAX_PART_FIELD_LENGTH - 1);
}

function truncate(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function readIdentityFallback(dataset: DOMStringMap): string | undefined {
	return isIdentifiedByCategory(dataset.naoPart) ? dataset.naoPartCategory : undefined;
}

/** KPI values and table cells are quoted by what they show, as their label only names it. */
function readPartQuote(part: StoryBlockPart): string | undefined {
	const shownValue = QUOTED_BY_VALUE_KINDS.has(part.kind) ? part.value : undefined;
	return shownValue ?? part.label ?? readIdentityText(part);
}

function readIdentityText(part: StoryBlockPart): string | undefined {
	return isIdentifiedByCategory(part.kind) ? part.category : undefined;
}

function isIdentifiedByCategory(kind: string | undefined): boolean {
	return kind === 'data-point' || kind === 'cell';
}

function withoutLabel(part: StoryBlockPart): StoryBlockPart {
	const { label: _label, ...rest } = part;
	return rest;
}
