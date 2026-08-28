import { popGridColumn, TAG_ATTRS } from '@nao/shared/story-segments';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { CardOrigin } from './story-editor-drag-context';

function encodeForAttr(str: string): string {
	return btoa(encodeURIComponent(str));
}

export function decodeFromAttr(encoded: string): string {
	return decodeURIComponent(atob(encoded));
}

/**
 * Replaces custom <chart />, <table /> and <grid> tags with HTML-safe elements that
 * Tiptap's DOMParser can match against custom node extensions.
 */
export function preprocessForEditor(code: string): string {
	// Each embed is wrapped in a <div> so that `marked` emits an "html" token
	// instead of folding the custom element into a paragraph token (marked only
	// recognises standard HTML block elements like <div>).
	let result = code.replace(/<grid(?:\s+[^>]*)?>[\s\S]*?<\/grid>/g, (match) => {
		return `<div><grid-embed data-raw="${encodeForAttr(match)}"></grid-embed></div>\n\n`;
	});

	result = result.replace(new RegExp(`<chart\\s+${TAG_ATTRS}\\/?>`, 'g'), (match) => {
		return `<div><chart-embed data-raw="${encodeForAttr(match)}"></chart-embed></div>\n\n`;
	});

	result = result.replace(new RegExp(`<table\\s+${TAG_ATTRS}\\/?>`, 'g'), (match) => {
		return `<div><table-embed data-raw="${encodeForAttr(match)}"></table-embed></div>\n\n`;
	});

	result = result.replace(new RegExp(`<map\\s+${TAG_ATTRS}\\/?>`, 'g'), (match) => {
		return `<div><map-embed data-raw="${encodeForAttr(match)}"></map-embed></div>\n\n`;
	});

	return result;
}

export function createBlockNode(schema: Schema, markup: string): PMNode | null {
	const trimmedMarkup = markup.trim();
	if (trimmedMarkup.startsWith('<chart')) {
		return schema.nodes.chartBlock?.create({ rawTag: trimmedMarkup }) ?? null;
	}
	if (trimmedMarkup.startsWith('<table')) {
		return schema.nodes.tableBlock?.create({ rawTag: trimmedMarkup }) ?? null;
	}
	if (trimmedMarkup.startsWith('<map')) {
		return schema.nodes.mapBlock?.create({ rawTag: trimmedMarkup }) ?? null;
	}
	if (trimmedMarkup.startsWith('<grid')) {
		return schema.nodes.gridBlock?.create({ rawContent: trimmedMarkup }) ?? null;
	}

	const paragraph = schema.nodes.paragraph;
	if (!paragraph) {
		return null;
	}
	return paragraph.create(null, trimmedMarkup ? schema.text(trimmedMarkup) : undefined);
}

export function removeCardFromOrigin(transaction: Transaction, state: EditorState, origin: CardOrigin): void {
	if (origin.kind === 'block') {
		const node = state.doc.nodeAt(origin.pos);
		if (!node) {
			return;
		}
		transaction.delete(transaction.mapping.map(origin.pos), transaction.mapping.map(origin.pos + node.nodeSize));
		return;
	}

	const gridNode = state.doc.nodeAt(origin.gridPos);
	if (!gridNode || gridNode.type.name !== 'gridBlock') {
		return;
	}
	const result = popGridColumn(gridNode.attrs.rawContent as string, origin.columnIndex);
	if (!result) {
		return;
	}
	const remainingNode = createBlockNode(state.schema, result.remaining);
	if (!remainingNode) {
		return;
	}
	transaction.replaceWith(
		transaction.mapping.map(origin.gridPos),
		transaction.mapping.map(origin.gridPos + gridNode.nodeSize),
		remainingNode,
	);
}

export function cloneElementWithStyles(node: HTMLElement): HTMLElement {
	const clone = node.cloneNode(true) as HTMLElement;
	const sources = [node, ...Array.from(node.getElementsByTagName('*'))];
	const targets = [clone, ...Array.from(clone.getElementsByTagName('*'))];
	sources.forEach((source, index) => {
		const target = targets[index];
		if (!(target instanceof HTMLElement || target instanceof SVGElement)) {
			return;
		}
		const computed = window.getComputedStyle(source as Element);
		let cssText = '';
		for (const property of computed) {
			cssText += `${property}:${computed.getPropertyValue(property)};`;
		}
		target.style.cssText = cssText;
	});
	return clone;
}

export function setCollapsedTextSelection(transaction: Transaction, position: number): void {
	const clampedPosition = Math.max(0, Math.min(position, transaction.doc.content.size));
	const $position = transaction.doc.resolve(clampedPosition);
	const nearbySelection =
		Selection.findFrom($position, 1, true) ?? Selection.findFrom($position, -1, true) ?? Selection.near($position);
	transaction.setSelection(TextSelection.create(transaction.doc, nearbySelection.from));
}

export function dispatchDropWithScroll(view: EditorView, transaction: Transaction, pos: number): void {
	setCollapsedTextSelection(transaction, pos);
	view.dispatch(transaction);
	scrollPosIntoView(view, pos);
}

export function scrollPosIntoView(view: EditorView, pos: number, gridColumnIndex?: number): void {
	requestAnimationFrame(() => {
		const clamped = Math.max(0, Math.min(pos, view.state.doc.content.size));
		const gridColumn =
			gridColumnIndex === undefined
				? null
				: view.dom.querySelector<HTMLElement>(
						`[data-grid-pos="${clamped}"][data-col-index="${gridColumnIndex}"]`,
					);
		const dom = gridColumn ?? view.nodeDOM(clamped);
		const element = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
		if (!element || isReasonablyVisible(element)) {
			return;
		}
		element.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});
}

const SCROLL_VISIBILITY_MARGIN = 24;

function isReasonablyVisible(element: HTMLElement): boolean {
	const scrollContainer = findVerticalScrollContainer(element);
	if (!scrollContainer) {
		return false;
	}

	const elementRect = element.getBoundingClientRect();
	const scrollportRect = scrollContainer.getBoundingClientRect();
	if (
		elementRect.bottom <= elementRect.top ||
		elementRect.right <= elementRect.left ||
		scrollportRect.bottom <= scrollportRect.top ||
		scrollportRect.right <= scrollportRect.left
	) {
		return false;
	}

	return (
		elementRect.top >= scrollportRect.top - SCROLL_VISIBILITY_MARGIN &&
		elementRect.bottom <= scrollportRect.bottom + SCROLL_VISIBILITY_MARGIN &&
		elementRect.left >= scrollportRect.left - SCROLL_VISIBILITY_MARGIN &&
		elementRect.right <= scrollportRect.right + SCROLL_VISIBILITY_MARGIN
	);
}

function findVerticalScrollContainer(element: HTMLElement): HTMLElement | null {
	let ancestor = element.parentElement;
	while (ancestor) {
		const { overflowY } = window.getComputedStyle(ancestor);
		if (['auto', 'scroll', 'overlay'].includes(overflowY) && ancestor.scrollHeight - ancestor.clientHeight > 1) {
			return ancestor;
		}
		ancestor = ancestor.parentElement;
	}
	return null;
}
