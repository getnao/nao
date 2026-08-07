import { popGridColumns, splitGridColumnsRaw } from '@nao/shared/story-segments';
import { Extension } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createBlockNode, setCollapsedTextSelection } from './story-editor-utils';

import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { CardOrigin } from './story-editor-drag-context';

export interface GridColumnRef {
	gridPos: number;
	index: number;
}

export interface BlockSelectionState {
	blocks: number[];
	gridColumns: GridColumnRef[];
	anchor: number | null;
	columnAnchor: GridColumnRef | null;
	movedMarkups?: string[];
}

export type DragUnit = { kind: 'block'; pos: number } | { kind: 'gridColumns'; gridPos: number; indices: number[] };

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

export function blockSelectionFromDragUnits(units: DragUnit[], movedMarkups?: string[]): BlockSelectionState {
	const blocks: number[] = [];
	const gridColumns: GridColumnRef[] = [];
	for (const unit of units) {
		if (unit.kind === 'block') {
			blocks.push(unit.pos);
			continue;
		}
		for (const index of unit.indices) {
			gridColumns.push({ gridPos: unit.gridPos, index });
		}
	}
	blocks.sort((first, second) => first - second);
	gridColumns.sort((first, second) => first.gridPos - second.gridPos || first.index - second.index);
	return withMovedMarkups(
		{
			blocks,
			gridColumns,
			anchor: blocks[0] ?? null,
			columnAnchor: gridColumns[0] ?? null,
		},
		movedMarkups,
	);
}

export function blockSelectionFromOrigin(origin: CardOrigin, movedMarkups?: string[]): BlockSelectionState {
	if (origin.kind === 'block') {
		return withMovedMarkups(
			{
				blocks: [origin.pos],
				gridColumns: [],
				anchor: origin.pos,
				columnAnchor: null,
			},
			movedMarkups,
		);
	}
	const column = { gridPos: origin.gridPos, index: origin.columnIndex };
	return withMovedMarkups(
		{
			blocks: [],
			gridColumns: [column],
			anchor: null,
			columnAnchor: column,
		},
		movedMarkups,
	);
}

export function blockSelectionForInsertedNodes(
	insertPos: number,
	nodes: PMNode[],
	movedMarkups?: string[],
): BlockSelectionState {
	const blocks: number[] = [];
	let position = insertPos;
	for (const node of nodes) {
		blocks.push(position);
		position += node.nodeSize;
	}
	return withMovedMarkups(
		{
			blocks,
			gridColumns: [],
			anchor: blocks[0] ?? null,
			columnAnchor: null,
		},
		movedMarkups,
	);
}

export function applyBlockSelection(view: EditorView, selection: BlockSelectionState): void {
	const transaction = view.state.tr;
	const selectedPositions = [...selection.blocks, ...selection.gridColumns.map((column) => column.gridPos)].sort(
		(first, second) => first - second,
	);
	const selectionPosition = selectedPositions[0];
	if (selectionPosition !== undefined) {
		setCollapsedTextSelection(transaction, selectionPosition);
	}
	transaction.setMeta(blockSelectionPluginKey, selection);
	transaction.setMeta('addToHistory', false);
	view.dispatch(transaction);
}

export function resolveDragSelection(
	state: EditorState,
	origin: { kind: 'block'; pos: number } | { kind: 'gridColumn'; gridPos: number; index: number },
): DragUnit[] | null {
	const selection = blockSelectionPluginKey.getState(state) ?? emptySelection();
	const originSelected =
		origin.kind === 'block'
			? selection.blocks.includes(origin.pos)
			: selection.gridColumns.some(
					(column) => column.gridPos === origin.gridPos && column.index === origin.index,
				);
	if (!originSelected) {
		return null;
	}

	const columnsByGrid = new Map<number, number[]>();
	for (const column of selection.gridColumns) {
		const indices = columnsByGrid.get(column.gridPos) ?? [];
		indices.push(column.index);
		columnsByGrid.set(column.gridPos, indices);
	}

	const units: DragUnit[] = [
		...selection.blocks.map((pos): DragUnit => ({ kind: 'block', pos })),
		...Array.from(
			columnsByGrid,
			([gridPos, indices]): DragUnit => ({
				kind: 'gridColumns',
				gridPos,
				indices: Array.from(new Set(indices)).sort((first, second) => first - second),
			}),
		),
	].sort((first, second) => dragUnitPosition(first) - dragUnitPosition(second));

	if (
		units.length === 1 &&
		(units[0].kind === 'block' || (units[0].kind === 'gridColumns' && units[0].indices.length === 1))
	) {
		return null;
	}
	return units;
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
	const already = current?.gridColumns.some((column) => column.gridPos === gridPos && column.index === index);
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
					if (
						meta.blocks.length === 0 &&
						meta.gridColumns.length === 0 &&
						!Object.hasOwn(meta, 'movedMarkups')
					) {
						return withMovedMarkups(meta, value.movedMarkups);
					}
					return meta;
				}
				if (!tr.docChanged) {
					return value;
				}
				if (isHistoryTransaction(tr)) {
					return value.movedMarkups === undefined
						? emptySelection()
						: selectionFromMovedMarkups(tr.doc, value.movedMarkups);
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
				return withMovedMarkups(
					{
						blocks,
						gridColumns,
						anchor,
						columnAnchor,
					},
					tr.getMeta('appendedTransaction') === undefined ? undefined : value.movedMarkups,
				);
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
							if ((toggle || range) && columnType !== 'chart' && columnType !== 'table') {
								return false;
							}
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
									view.focus();
									return false;
								}
								event.preventDefault();
								const next = selectColumnFromHandle(view.state, gridPos, index);
								if (next) {
									view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, next));
								}
								view.focus();
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
										...current,
										gridColumns,
										columnAnchor: column,
									}),
								);
								view.focus();
								return true;
							}

							const columnAnchor = current.columnAnchor;
							const gridColumns =
								columnAnchor?.gridPos === gridPos
									? columnRange(gridPos, columnAnchor.index, index)
									: [column];
							view.dispatch(
								view.state.tr.setMeta(blockSelectionPluginKey, {
									...current,
									gridColumns,
									columnAnchor: columnAnchor?.gridPos === gridPos ? columnAnchor : column,
								}),
							);
							view.focus();
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
								view.focus();
								return false;
							}
							event.preventDefault();
							view.dispatch(view.state.tr.setMeta(blockSelectionPluginKey, next));
							view.focus();
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
					if (view.state.doc.nodeAt(blockPosition)?.type.name === 'gridBlock') {
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
								...current,
								blocks,
								anchor: blockPosition,
							}),
						);
						view.focus();
						return true;
					}

					const anchor = current.anchor ?? blockPosition;
					view.dispatch(
						view.state.tr.setMeta(blockSelectionPluginKey, {
							...current,
							blocks: rangeBetween(view.state.doc, anchor, blockPosition),
							anchor,
						}),
					);
					view.focus();
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

interface DragUnitOperation {
	node: PMNode;
	from: number;
	to: number;
	remainingNode: PMNode | null;
	movedMarkups: string[];
}

export function buildDragUnitNodes(state: EditorState, units: DragUnit[]): PMNode[] | null {
	return buildDragUnitOperations(state, units)?.map((operation) => operation.node) ?? null;
}

export function buildSelectionMoveTransaction(
	state: EditorState,
	units: DragUnit[],
	dropPos: number,
): BlockMove | null {
	const operations = buildDragUnitOperations(state, units);
	if (!operations || operations.length === 0) {
		return null;
	}

	const nodes = operations.map((operation) => operation.node);
	const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
	let insertPos = dropPoint(state.doc, dropPos, slice);
	if (insertPos === null) {
		return null;
	}

	for (const operation of operations) {
		if (insertPos <= operation.from || insertPos >= operation.to) {
			continue;
		}
		if (operation.remainingNode === null) {
			return null;
		}
		insertPos = operation.to;
	}

	const ranges = [...operations].sort((first, second) => first.from - second.from);
	if (
		ranges.some(
			(operation, index) => index > 0 && ranges[index - 1].to === insertPos && operation.from === insertPos,
		)
	) {
		return null;
	}

	const transaction = state.tr;
	for (const operation of [...operations].sort((first, second) => second.from - first.from)) {
		if (operation.remainingNode) {
			transaction.replaceWith(operation.from, operation.to, operation.remainingNode);
		} else {
			transaction.delete(operation.from, operation.to);
		}
	}
	const mappedInsert = transaction.mapping.map(insertPos);
	transaction.insert(mappedInsert, Fragment.fromArray(nodes));
	const movedMarkups = operations.flatMap((operation) => operation.movedMarkups);
	transaction.setMeta(blockSelectionPluginKey, blockSelectionForInsertedNodes(mappedInsert, nodes, movedMarkups));
	setCollapsedTextSelection(transaction, mappedInsert);
	return { transaction, insertPos: mappedInsert };
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
	transaction.setMeta(
		blockSelectionPluginKey,
		blockSelectionForInsertedNodes(mappedInsert, nodes, nodes.flatMap(rawMarkupsForNode)),
	);
	setCollapsedTextSelection(transaction, mappedInsert);
	return { transaction, insertPos: mappedInsert };
}

function buildDragUnitOperations(state: EditorState, units: DragUnit[]): DragUnitOperation[] | null {
	const operations: DragUnitOperation[] = [];
	const orderedUnits = [...units].sort((first, second) => dragUnitPosition(first) - dragUnitPosition(second));
	for (const unit of orderedUnits) {
		if (unit.kind === 'block') {
			const node = state.doc.nodeAt(unit.pos);
			if (!node) {
				return null;
			}
			operations.push({
				node,
				from: unit.pos,
				to: unit.pos + node.nodeSize,
				remainingNode: null,
				movedMarkups: rawMarkupsForNode(node),
			});
			continue;
		}

		const grid = state.doc.nodeAt(unit.gridPos);
		if (!grid || grid.type.name !== 'gridBlock') {
			return null;
		}
		const result = popGridColumns(grid.attrs.rawContent as string, unit.indices);
		const node = result ? createBlockNode(state.schema, result.popped) : null;
		const remainingNode = result?.remaining == null ? null : createBlockNode(state.schema, result.remaining);
		if (!result || !node || (result.remaining !== null && !remainingNode)) {
			return null;
		}
		operations.push({
			node,
			from: unit.gridPos,
			to: unit.gridPos + grid.nodeSize,
			remainingNode,
			movedMarkups: unit.indices
				.map((index) => splitGridColumnsRaw(grid.attrs.rawContent as string).columns[index])
				.filter((markup): markup is string => markup !== undefined),
		});
	}
	return operations;
}

function dragUnitPosition(unit: DragUnit): number {
	return unit.kind === 'block' ? unit.pos : unit.gridPos;
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

function selectionFromMovedMarkups(doc: PMNode, movedMarkups: string[]): BlockSelectionState {
	const blocks: number[] = [];
	const gridColumns: GridColumnRef[] = [];
	const usedBlocks = new Set<number>();
	const usedGridColumns = new Set<string>();
	const normalizedMarkups = normalizeMovedMarkups(movedMarkups);
	for (const markup of normalizedMarkups) {
		const matches: Array<{ block: number } | { gridColumn: GridColumnRef }> = [];
		doc.forEach((node, position) => {
			const blockMarkup = rawMarkupForBlock(node);
			if (blockMarkup?.trim() === markup && !usedBlocks.has(position)) {
				matches.push({ block: position });
			}
			if (node.type.name !== 'gridBlock') {
				return;
			}
			for (const [index, column] of splitGridColumnsRaw(node.attrs.rawContent as string).columns.entries()) {
				if (column.trim() === markup && !usedGridColumns.has(gridColumnKey(position, index))) {
					matches.push({ gridColumn: { gridPos: position, index } });
				}
			}
		});
		if (matches.length !== 1) {
			continue;
		}
		const [match] = matches;
		if ('block' in match) {
			blocks.push(match.block);
			usedBlocks.add(match.block);
		} else {
			gridColumns.push(match.gridColumn);
			usedGridColumns.add(gridColumnKey(match.gridColumn.gridPos, match.gridColumn.index));
		}
	}

	blocks.sort((first, second) => first - second);
	gridColumns.sort((first, second) => first.gridPos - second.gridPos || first.index - second.index);
	return {
		blocks,
		gridColumns,
		anchor: blocks[0] ?? null,
		columnAnchor: gridColumns[0] ?? null,
		movedMarkups: normalizedMarkups,
	};
}

function rawMarkupForBlock(node: PMNode): string | null {
	if (node.type.name === 'chartBlock' || node.type.name === 'tableBlock') {
		return node.attrs.rawTag as string;
	}
	return null;
}

function rawMarkupsForNode(node: PMNode): string[] {
	const blockMarkup = rawMarkupForBlock(node);
	if (blockMarkup !== null) {
		return [blockMarkup];
	}
	return node.type.name === 'gridBlock' ? splitGridColumnsRaw(node.attrs.rawContent as string).columns : [];
}

function withMovedMarkups(selection: BlockSelectionState, movedMarkups?: string[]): BlockSelectionState {
	return movedMarkups === undefined ? selection : { ...selection, movedMarkups: normalizeMovedMarkups(movedMarkups) };
}

function normalizeMovedMarkups(markups: string[]): string[] {
	return markups.map((markup) => markup.trim()).filter(Boolean);
}

function gridColumnKey(gridPos: number, index: number): string {
	return `${gridPos}:${index}`;
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
