import { splitGridColumnsRaw } from '@nao/shared/story-segments';
import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface GridColumnRef {
	gridPos: number;
	index: number;
}

export interface BlockSelectionState {
	blocks: number[];
	gridColumns: GridColumnRef[];
	anchor: number | null;
	columnAnchor: GridColumnRef | null;
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

export function getSelectedGridColumns(state: EditorState): GridColumnRef[] {
	return blockSelectionPluginKey.getState(state)?.gridColumns ?? [];
}

export function emptySelection(): BlockSelectionState {
	return { blocks: [], gridColumns: [], anchor: null, columnAnchor: null };
}

export function resolveDragBlocks(state: EditorState, pos: number): { positions: number[]; isMulti: boolean } {
	const selected = getSelectedBlockPositions(state);
	if (selected.length > 1 && selected.includes(pos)) {
		return {
			positions: [...selected].sort((first, second) => first - second),
			isMulti: true,
		};
	}
	return { positions: [pos], isMulti: false };
}

/**
 * Selection to apply when a block's drag handle is clicked: select just that block,
 * or `null` (no-op) when it is already part of the current selection.
 */
export function selectBlockFromHandle(state: EditorState, pos: number): BlockSelectionState | null {
	const current = blockSelectionPluginKey.getState(state);
	if (current?.blocks.includes(pos)) {
		return null;
	}
	return { blocks: [pos], gridColumns: [], anchor: pos, columnAnchor: null };
}

export function selectColumnFromHandle(state: EditorState, gridPos: number, index: number): BlockSelectionState | null {
	const current = blockSelectionPluginKey.getState(state);
	const already =
		current?.gridColumns.length === 1 &&
		current.gridColumns[0].gridPos === gridPos &&
		current.gridColumns[0].index === index;
	if (already) {
		return null;
	}
	return {
		blocks: [],
		gridColumns: [{ gridPos, index }],
		anchor: null,
		columnAnchor: { gridPos, index },
	};
}

function buildBlockSelectionPlugin(): Plugin<BlockSelectionState> {
	return new Plugin<BlockSelectionState>({
		key: blockSelectionPluginKey,
		state: {
			init: emptySelection,
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
				const changedGridPositions = getChangedGridPositions(tr, value);
				const gridColumns = value.gridColumns
					.map(({ gridPos, index }) => ({ gridPos: tr.mapping.map(gridPos, -1), index }))
					.filter((column) => !changedGridPositions.has(column.gridPos) && isValidGridColumn(tr.doc, column));
				const mappedColumnAnchor =
					value.columnAnchor == null
						? null
						: {
								gridPos: tr.mapping.map(value.columnAnchor.gridPos, -1),
								index: value.columnAnchor.index,
							};
				const columnAnchor =
					mappedColumnAnchor != null &&
					!changedGridPositions.has(mappedColumnAnchor.gridPos) &&
					isValidGridColumn(tr.doc, mappedColumnAnchor)
						? mappedColumnAnchor
						: null;
				return { blocks, gridColumns, anchor, columnAnchor };
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
					const target = event.target;
					if (target instanceof Element && target.closest('[data-block-drag-grip]')) {
						return false;
					}
					if (target instanceof Element && target.closest('button, a, input, textarea, select')) {
						return false;
					}

					const toggle = event.metaKey || event.ctrlKey;
					const range = event.shiftKey;
					const current = blockSelectionPluginKey.getState(view.state) ?? emptySelection();
					const columnElement = target instanceof Element ? target.closest('[data-grid-column]') : null;
					if (columnElement) {
						const gridPosAttribute = columnElement.getAttribute('data-grid-pos');
						const indexAttribute = columnElement.getAttribute('data-col-index');
						const columnType = columnElement.getAttribute('data-col-type');
						const gridPos = Number(gridPosAttribute);
						const index = Number(indexAttribute);
						if (
							gridPosAttribute !== null &&
							indexAttribute !== null &&
							Number.isInteger(gridPos) &&
							Number.isInteger(index)
						) {
							if (!toggle && !range) {
								if (columnType !== 'chart' && columnType !== 'table') {
									if (current.blocks.length || current.gridColumns.length) {
										view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
									}
									return false;
								}
								const alreadySelected = current.gridColumns.some(
									(selected) => selected.gridPos === gridPos && selected.index === index,
								);
								if (alreadySelected) {
									// Already selected (alone or within a multi-selection): let the native
									// drag start so the column can be dragged directly from its body.
									return false;
								}
								event.preventDefault();
								const next = selectColumnFromHandle(view.state, gridPos, index);
								if (next) {
									view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, next));
								}
								return true;
							}

							event.preventDefault();
							const column = { gridPos, index };
							if (toggle) {
								const hasColumn = current.gridColumns.some(
									(selected) => selected.gridPos === gridPos && selected.index === index,
								);
								const gridColumns = hasColumn
									? current.gridColumns.filter(
											(selected) => selected.gridPos !== gridPos || selected.index !== index,
										)
									: [...current.gridColumns, column];
								view.dispatch(
									view.state.tr.setMeta(blockSelectionPluginKey, {
										...emptySelection(),
										gridColumns,
										columnAnchor: column,
									}),
								);
								return true;
							}

							const columnAnchor = current.columnAnchor;
							const gridColumns =
								columnAnchor?.gridPos === gridPos
									? columnRange(gridPos, columnAnchor.index, index)
									: [column];
							view.dispatch(
								view.state.tr.setMeta(blockSelectionPluginKey, {
									...emptySelection(),
									gridColumns,
									columnAnchor: columnAnchor?.gridPos === gridPos ? columnAnchor : column,
								}),
							);
							return true;
						}
					}

					if (!toggle && !range) {
						const clickCoordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
						const clickedBlockPos =
							clickCoordinates != null
								? topLevelBlockPosAt(view, clickCoordinates.pos, event.clientX, event.clientY)
								: null;
						const clickedNode = clickedBlockPos == null ? null : view.state.doc.nodeAt(clickedBlockPos);
						if (
							clickedNode != null &&
							clickedBlockPos != null &&
							(clickedNode.type.name === 'chartBlock' || clickedNode.type.name === 'tableBlock')
						) {
							const next = selectBlockFromHandle(view.state, clickedBlockPos);
							if (!next) {
								// Already selected: allow the native drag to start so the block can
								// be dragged directly from its body.
								return false;
							}
							event.preventDefault();
							view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, next));
							return true;
						}
						if (clickedNode != null && clickedNode.type.name === 'gridBlock') {
							event.preventDefault();
							if (current.blocks.length || current.gridColumns.length) {
								view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
							}
							return true;
						}
						if (current.blocks.length || current.gridColumns.length) {
							view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
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
								...emptySelection(),
								blocks,
								anchor: blockPosition,
							}),
						);
						return true;
					}

					const anchor = current.anchor ?? blockPosition;
					view.dispatch(
						view.state.tr.setMeta(blockSelectionPluginKey, {
							...emptySelection(),
							blocks: rangeBetween(view.state.doc, anchor, blockPosition),
							anchor,
						}),
					);
					return true;
				},
			},
			handleKeyDown(view, event) {
				const selection = blockSelectionPluginKey.getState(view.state);
				if (event.key !== 'Escape' || (!selection?.blocks.length && !selection?.gridColumns.length)) {
					return false;
				}

				view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
				return true;
			},
		},
		view(editorView) {
			const clearSelection = () => {
				const current = blockSelectionPluginKey.getState(editorView.state);
				if (!current?.blocks.length && !current?.gridColumns.length) {
					return;
				}
				editorView.dispatch(editorView.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
			};

			const onMouseDown = (event: MouseEvent) => {
				const target = event.target;
				if (target instanceof Node && editorView.dom.contains(target)) {
					return;
				}
				if (target instanceof Element && target.closest('.drag-handle')) {
					return;
				}
				clearSelection();
			};

			const onKeyDown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') {
					clearSelection();
				}
			};

			document.addEventListener('mousedown', onMouseDown, true);
			document.addEventListener('keydown', onKeyDown, true);

			return {
				destroy() {
					document.removeEventListener('mousedown', onMouseDown, true);
					document.removeEventListener('keydown', onKeyDown, true);
				},
			};
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
	transaction.setMeta(blockSelectionPluginKey, emptySelection());
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

function getChangedGridPositions(tr: Transaction, selection: BlockSelectionState): Set<number> {
	const originalPositions = new Set(selection.gridColumns.map((column) => column.gridPos));
	if (selection.columnAnchor) {
		originalPositions.add(selection.columnAnchor.gridPos);
	}

	const changedPositions = new Set<number>();
	for (const position of originalPositions) {
		const mappedPosition = tr.mapping.map(position, -1);
		if (!hasUnchangedGridContent(tr.before.nodeAt(position), tr.doc.nodeAt(mappedPosition))) {
			changedPositions.add(mappedPosition);
		}
	}
	return changedPositions;
}

function hasUnchangedGridContent(before: PMNode | null, after: PMNode | null): boolean {
	return before?.type.name === 'gridBlock' && before === after;
}

function isValidGridColumn(doc: PMNode, column: GridColumnRef): boolean {
	const node = doc.nodeAt(column.gridPos);
	if (!node || node.type.name !== 'gridBlock') {
		return false;
	}
	const columnCount = splitGridColumnsRaw(node.attrs.rawContent as string).columns.length;
	return column.index >= 0 && column.index < columnCount;
}

function columnRange(gridPos: number, first: number, second: number): GridColumnRef[] {
	const start = Math.min(first, second);
	const end = Math.max(first, second);
	return Array.from({ length: end - start + 1 }, (_, offset) => ({
		gridPos,
		index: start + offset,
	}));
}
