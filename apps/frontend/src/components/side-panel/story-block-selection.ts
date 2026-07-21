import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

interface BlockSelectionState {
	blocks: number[];
	anchor: number | null;
}

export const blockSelectionPluginKey = new PluginKey<BlockSelectionState>('blockSelection');

export const BlockSelection = Extension.create({
	name: 'blockSelection',

	addProseMirrorPlugins() {
		return [buildBlockSelectionPlugin()];
	},
});

export function getSelectedBlockPositions(state: EditorState): number[] {
	return blockSelectionPluginKey.getState(state)?.blocks ?? [];
}

function buildBlockSelectionPlugin(): Plugin<BlockSelectionState> {
	return new Plugin<BlockSelectionState>({
		key: blockSelectionPluginKey,
		state: {
			init: () => ({ blocks: [], anchor: null }),
			apply(tr, value) {
				const meta = tr.getMeta(blockSelectionPluginKey) as BlockSelectionState | undefined;
				if (meta !== undefined) {
					return meta;
				}
				if (!tr.docChanged) {
					return value;
				}

				const valid = new Set(topLevelBlockPositions(tr.doc));
				const blocks = value.blocks
					.map((position) => tr.mapping.map(position, -1))
					.filter((position) => valid.has(position));
				const mappedAnchor = value.anchor == null ? null : tr.mapping.map(value.anchor, -1);
				const anchor = mappedAnchor != null && valid.has(mappedAnchor) ? mappedAnchor : null;
				return { blocks, anchor };
			},
		},
		props: {
			decorations(state) {
				const selection = blockSelectionPluginKey.getState(state);
				if (!selection?.blocks.length) {
					return DecorationSet.empty;
				}

				const decorations: Decoration[] = [];
				for (const position of selection.blocks) {
					const node = state.doc.nodeAt(position);
					if (node) {
						decorations.push(
							Decoration.node(position, position + node.nodeSize, {
								class: 'nao-block-selected',
							}),
						);
					}
				}
				return DecorationSet.create(state.doc, decorations);
			},
			handleDOMEvents: {
				mousedown(view, event) {
					const toggle = event.metaKey || event.ctrlKey;
					const range = event.shiftKey;
					const current = blockSelectionPluginKey.getState(view.state) ?? { blocks: [], anchor: null };

					if (!toggle && !range) {
						if (current.blocks.length) {
							view.dispatch(
								view.state.tr.setMeta(blockSelectionPluginKey, {
									blocks: [],
									anchor: null,
								}),
							);
						}
						return false;
					}

					const coordinates = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (!coordinates) {
						return false;
					}

					const blockPosition = topLevelBlockPosAt(view, coordinates.pos, event.clientX, event.clientY);
					if (blockPosition == null) {
						return false;
					}

					event.preventDefault();

					if (toggle) {
						const hasBlock = current.blocks.includes(blockPosition);
						const blocks = hasBlock
							? current.blocks.filter((position) => position !== blockPosition)
							: [...current.blocks, blockPosition].sort((first, second) => first - second);
						view.dispatch(
							view.state.tr.setMeta(blockSelectionPluginKey, {
								blocks,
								anchor: blockPosition,
							}),
						);
						return true;
					}

					const anchor = current.anchor ?? blockPosition;
					view.dispatch(
						view.state.tr.setMeta(blockSelectionPluginKey, {
							blocks: rangeBetween(view.state.doc, anchor, blockPosition),
							anchor,
						}),
					);
					return true;
				},
			},
			handleKeyDown(view, event) {
				const selection = blockSelectionPluginKey.getState(view.state);
				if (event.key !== 'Escape' || !selection?.blocks.length) {
					return false;
				}

				view.dispatch(
					view.state.tr.setMeta(blockSelectionPluginKey, {
						blocks: [],
						anchor: null,
					}),
				);
				return true;
			},
		},
	});
}

export function topLevelBlockPositions(doc: PMNode): number[] {
	const positions: number[] = [];
	doc.forEach((_node, offset) => positions.push(offset));
	return positions;
}

export function isDropInsideSelection(doc: PMNode, insertPos: number, selected: number[]): boolean {
	const selectedSet = new Set(selected);
	const $insert = doc.resolve(insertPos);
	const nodeBefore = $insert.nodeBefore;
	const nodeAfter = $insert.nodeAfter;
	const beforeSelected = nodeBefore != null && selectedSet.has(insertPos - nodeBefore.nodeSize);
	const afterSelected = nodeAfter != null && selectedSet.has(insertPos);
	return beforeSelected && afterSelected;
}

export interface BlockMove {
	transaction: Transaction;
	insertPos: number;
}

export function buildBlockMoveTransaction(
	state: EditorState,
	positions: number[],
	insertPos: number,
): BlockMove | null {
	const nodes = positions
		.map((position) => state.doc.nodeAt(position))
		.filter((node): node is PMNode => node != null);
	if (nodes.length === 0 || isDropInsideSelection(state.doc, insertPos, positions)) {
		return null;
	}

	const transaction = state.tr;
	for (const position of [...positions].sort((first, second) => second - first)) {
		const node = state.doc.nodeAt(position);
		if (!node) {
			continue;
		}
		transaction.delete(position, position + node.nodeSize);
	}

	const mappedInsert = transaction.mapping.map(insertPos);
	transaction.insert(mappedInsert, Fragment.fromArray(nodes));
	transaction.setMeta(blockSelectionPluginKey, { blocks: [], anchor: null });
	return { transaction, insertPos: mappedInsert };
}

function topLevelBlockPosAt(view: EditorView, position: number, clientX: number, clientY: number): number | null {
	const $position = view.state.doc.resolve(position);
	if ($position.depth > 0) {
		return $position.before(1);
	}

	const candidates: number[] = [];
	if ($position.nodeAfter) {
		candidates.push($position.pos);
	}
	if ($position.nodeBefore) {
		candidates.push($position.pos - $position.nodeBefore.nodeSize);
	}

	for (const candidate of candidates) {
		const dom = view.nodeDOM(candidate);
		if (!(dom instanceof HTMLElement)) {
			continue;
		}
		const rect = dom.getBoundingClientRect();
		if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
			return candidate;
		}
	}

	return candidates[0] ?? null;
}

export function rangeBetween(doc: PMNode, first: number, second: number): number[] {
	const start = Math.min(first, second);
	const end = Math.max(first, second);
	return topLevelBlockPositions(doc).filter((position) => position >= start && position <= end);
}
