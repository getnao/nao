// @vitest-environment jsdom

import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { splitGridColumnsRaw } from '@nao/shared/story-segments';

import {
	BlockSelection,
	blockSelectionPluginKey,
	buildBlockMoveTransaction,
	buildSelectionMoveTransaction,
	emptySelection,
	getSelectedBlockPositions,
	getSelectedGridColumns,
	isDropInsideSelection,
	rangeBetween,
	resolveDragSelection,
	selectBlockFromHandle,
	selectColumnFromHandle,
	topLevelBlockPositions,
} from '@/components/side-panel/story-block-selection';

function createEditor(): Editor {
	return new Editor({
		extensions: [StarterKit, BlockSelection],
		content: '<p>AA</p><p>BB</p><p>CC</p>',
	});
}

const TestGridBlock = Node.create({
	name: 'gridBlock',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			rawContent: { default: '' },
		};
	},

	renderHTML({ HTMLAttributes }) {
		return ['grid-embed', HTMLAttributes];
	},
});

const TestChartBlock = Node.create({
	name: 'chartBlock',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			rawTag: { default: '' },
		};
	},

	renderHTML({ HTMLAttributes }) {
		return ['chart-embed', HTMLAttributes];
	},
});

const TestTableBlock = Node.create({
	name: 'tableBlock',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			rawTag: { default: '' },
		};
	},

	renderHTML({ HTMLAttributes }) {
		return ['table-embed', HTMLAttributes];
	},
});

const FIRST_GRID = '<grid><chart query_id="q1" chart_type="line" x_axis_key="month" /></grid>';
const FIRST_GRID_REORDERED = '<grid><chart query_id="q1" chart_type="bar" x_axis_key="month" /></grid>';
const SECOND_GRID = '<grid><chart query_id="q2" chart_type="bar" x_axis_key="month" /></grid>';
const FIRST_THREE_COLUMN_GRID = `<grid widths="1,1,1">
<chart query_id="q1" chart_type="line" x_axis_key="month" />
<chart query_id="q2" chart_type="bar" x_axis_key="month" />
<chart query_id="q3" chart_type="area" x_axis_key="month" />
</grid>`;
const SECOND_THREE_COLUMN_GRID = `<grid widths="1,1,1">
<table query_id="q4" />
<chart query_id="q5" chart_type="bar" x_axis_key="month" />
<chart query_id="q6" chart_type="line" x_axis_key="month" />
</grid>`;

function createGridEditor(secondGridContent = SECOND_GRID): Editor {
	return createDocumentEditor([
		{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
		{ type: 'gridBlock', attrs: { rawContent: FIRST_GRID } },
		{ type: 'gridBlock', attrs: { rawContent: secondGridContent } },
		{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
	]);
}

function createDocumentEditor(content: Record<string, unknown>[]): Editor {
	return new Editor({
		extensions: [StarterKit, TestGridBlock, TestChartBlock, TestTableBlock, BlockSelection],
		content: {
			type: 'doc',
			content,
		},
	});
}

function selectBlocks(editor: Editor, blocks: number[], anchor: number | null): void {
	editor.view.dispatch(
		editor.state.tr.setMeta(blockSelectionPluginKey, {
			...emptySelection(),
			blocks,
			anchor,
		}),
	);
}

function selectMixed(editor: Editor, blocks: number[], gridColumns: { gridPos: number; index: number }[]): void {
	editor.view.dispatch(
		editor.state.tr.setMeta(blockSelectionPluginKey, {
			blocks,
			gridColumns,
			anchor: blocks[0] ?? null,
			columnAnchor: gridColumns[0] ?? null,
		}),
	);
}

function dispatchEditorMouseDown(target: Element, init?: MouseEventInit): void {
	const elementFromPoint = document.elementFromPoint;
	Object.defineProperty(document, 'elementFromPoint', {
		configurable: true,
		value: () => null,
	});
	try {
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100, ...init }));
	} finally {
		Object.defineProperty(document, 'elementFromPoint', {
			configurable: true,
			value: elementFromPoint,
		});
	}
}

function dispatchEditorMouseDownAtPosition(
	editor: Editor,
	target: Element,
	position: number,
	init?: MouseEventInit,
): void {
	const posAtCoords = editor.view.posAtCoords;
	editor.view.posAtCoords = () => ({ pos: position, inside: position });
	try {
		dispatchEditorMouseDown(target, init);
	} finally {
		editor.view.posAtCoords = posAtCoords;
	}
}

function createColumnElement(
	gridPos: number,
	index: number,
	type: 'chart' | 'table' | 'markdown' | 'grid',
): HTMLDivElement {
	const column = document.createElement('div');
	column.setAttribute('data-grid-column', '');
	column.setAttribute('data-grid-pos', String(gridPos));
	column.setAttribute('data-col-index', String(index));
	column.setAttribute('data-col-type', type);
	return column;
}

describe('story block selection', () => {
	let editor: Editor;

	beforeEach(() => {
		editor = createEditor();
	});

	afterEach(() => {
		editor.destroy();
	});

	it('lists every top-level block position', () => {
		expect(topLevelBlockPositions(editor.state.doc)).toHaveLength(3);
	});

	it('builds an inclusive range between two blocks regardless of order', () => {
		const [first, second, third] = topLevelBlockPositions(editor.state.doc);
		expect(rangeBetween(editor.state.doc, first, third)).toEqual([first, second, third]);
		expect(rangeBetween(editor.state.doc, third, first)).toEqual([first, second, third]);
		expect(rangeBetween(editor.state.doc, second, second)).toEqual([second]);
	});

	it('starts with no selection', () => {
		expect(getSelectedBlockPositions(editor.state)).toEqual([]);
	});

	it('stores and clears the selected blocks', () => {
		const [first, , third] = topLevelBlockPositions(editor.state.doc);
		selectBlocks(editor, [first, third], first);
		expect(getSelectedBlockPositions(editor.state)).toEqual([first, third]);

		selectBlocks(editor, [], null);
		expect(getSelectedBlockPositions(editor.state)).toEqual([]);
	});

	describe('mousedown handling', () => {
		it('keeps the selection when pressing an embed drag grip', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, second], first);
			const grip = document.createElement('button');
			grip.setAttribute('data-block-drag-grip', '');
			editor.view.dom.appendChild(grip);

			dispatchEditorMouseDown(grip);

			expect(getSelectedBlockPositions(editor.state)).toEqual([first, second]);
		});

		it('keeps the selection when pressing an SVG inside an embed drag grip', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, second], first);
			const grip = document.createElement('button');
			grip.setAttribute('data-block-drag-grip', '');
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			svg.appendChild(path);
			grip.appendChild(svg);
			editor.view.dom.appendChild(grip);

			dispatchEditorMouseDown(path);

			expect(getSelectedBlockPositions(editor.state)).toEqual([first, second]);
		});

		it('keeps the selection when pressing an SVG inside a gutter drag handle', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, second], first);
			const handle = document.createElement('div');
			handle.className = 'drag-handle';
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			svg.appendChild(path);
			handle.appendChild(svg);
			document.body.appendChild(handle);

			dispatchEditorMouseDown(path);

			expect(getSelectedBlockPositions(editor.state)).toEqual([first, second]);
			handle.remove();
		});

		it('clears the selection on a plain editor mousedown', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, second], first);
			const target = editor.view.dom.firstElementChild;
			expect(target).not.toBeNull();

			if (target) {
				dispatchEditorMouseDown(target);
			}

			expect(getSelectedBlockPositions(editor.state)).toEqual([]);
		});

		it('ignores modifier-clicks on grid padding', () => {
			const gridEditor = createGridEditor();
			const [, gridPos] = topLevelBlockPositions(gridEditor.state.doc);

			dispatchEditorMouseDownAtPosition(gridEditor, gridEditor.view.dom, gridPos, { metaKey: true });

			expect(getSelectedBlockPositions(gridEditor.state)).toEqual([]);
			expect(getSelectedGridColumns(gridEditor.state)).toEqual([]);
			gridEditor.destroy();
		});

		it('ignores shift-clicks on grid padding', () => {
			const gridEditor = createGridEditor();
			const [, gridPos] = topLevelBlockPositions(gridEditor.state.doc);

			dispatchEditorMouseDownAtPosition(gridEditor, gridEditor.view.dom, gridPos, { shiftKey: true });

			expect(getSelectedBlockPositions(gridEditor.state)).toEqual([]);
			expect(getSelectedGridColumns(gridEditor.state)).toEqual([]);
			gridEditor.destroy();
		});

		it('keeps mixed selection when modifier-clicking grid padding', () => {
			const gridEditor = createGridEditor();
			const [paragraphPos, gridPos] = topLevelBlockPositions(gridEditor.state.doc);
			selectMixed(gridEditor, [paragraphPos], [{ gridPos, index: 0 }]);

			dispatchEditorMouseDownAtPosition(gridEditor, gridEditor.view.dom, gridPos, { metaKey: true });

			expect(getSelectedBlockPositions(gridEditor.state)).toEqual([paragraphPos]);
			expect(getSelectedGridColumns(gridEditor.state)).toEqual([{ gridPos, index: 0 }]);
			expect(blockSelectionPluginKey.getState(gridEditor.state)).toEqual({
				blocks: [paragraphPos],
				gridColumns: [{ gridPos, index: 0 }],
				anchor: paragraphPos,
				columnAnchor: { gridPos, index: 0 },
			});
			gridEditor.destroy();
		});

		it('toggles grid columns with the modifier key', () => {
			const column = createColumnElement(4, 1, 'chart');
			editor.view.dom.appendChild(column);

			dispatchEditorMouseDown(column, { ctrlKey: true });
			expect(getSelectedGridColumns(editor.state)).toEqual([{ gridPos: 4, index: 1 }]);

			dispatchEditorMouseDown(column, { ctrlKey: true });
			expect(getSelectedGridColumns(editor.state)).toEqual([]);
		});

		it('selects a grid-column range from the column anchor', () => {
			const first = createColumnElement(4, 0, 'chart');
			const third = createColumnElement(4, 2, 'chart');
			editor.view.dom.append(first, third);

			dispatchEditorMouseDown(first, { ctrlKey: true });
			dispatchEditorMouseDown(third, { shiftKey: true });

			expect(getSelectedGridColumns(editor.state)).toEqual([
				{ gridPos: 4, index: 0 },
				{ gridPos: 4, index: 1 },
				{ gridPos: 4, index: 2 },
			]);
		});

		it('keeps blocks and grid columns selected across modifier-clicks', () => {
			const gridEditor = createGridEditor();
			const [paragraphPos, gridPos] = topLevelBlockPositions(gridEditor.state.doc);
			const column = createColumnElement(gridPos, 0, 'chart');
			gridEditor.view.dom.appendChild(column);
			selectMixed(gridEditor, [], [{ gridPos, index: 0 }]);

			const paragraph = gridEditor.view.dom.firstElementChild;
			expect(paragraph).not.toBeNull();
			if (paragraph) {
				dispatchEditorMouseDownAtPosition(gridEditor, paragraph, paragraphPos + 1, { ctrlKey: true });
			}

			expect(getSelectedBlockPositions(gridEditor.state)).toEqual([paragraphPos]);
			expect(getSelectedGridColumns(gridEditor.state)).toEqual([{ gridPos, index: 0 }]);

			selectMixed(gridEditor, [paragraphPos], []);
			dispatchEditorMouseDown(column, { ctrlKey: true });

			expect(getSelectedBlockPositions(gridEditor.state)).toEqual([paragraphPos]);
			expect(getSelectedGridColumns(gridEditor.state)).toEqual([{ gridPos, index: 0 }]);
			gridEditor.destroy();
		});

		it('ignores modifier-clicks on markdown grid columns', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectMixed(editor, [first], [{ gridPos: 4, index: 0 }]);
			const markdown = createColumnElement(4, 1, 'markdown');
			editor.view.dom.appendChild(markdown);

			dispatchEditorMouseDown(markdown, { ctrlKey: true });

			expect(blockSelectionPluginKey.getState(editor.state)).toEqual({
				blocks: [first],
				gridColumns: [{ gridPos: 4, index: 0 }],
				anchor: first,
				columnAnchor: { gridPos: 4, index: 0 },
			});
		});
	});

	describe('resolveDragSelection', () => {
		it('returns null for an unselected block', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			expect(resolveDragSelection(editor.state, { kind: 'block', pos: first })).toBeNull();
		});

		it('returns null for a lone selected block', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			expect(resolveDragSelection(editor.state, { kind: 'block', pos: first })).toBeNull();
		});

		it('returns null for a lone selected grid column', () => {
			selectMixed(editor, [], [{ gridPos: 4, index: 1 }]);
			expect(resolveDragSelection(editor.state, { kind: 'gridColumn', gridPos: 4, index: 1 })).toBeNull();
		});

		it('groups columns and sorts mixed units in document order', () => {
			const [first, second, third] = topLevelBlockPositions(editor.state.doc);
			selectMixed(
				editor,
				[third, first],
				[
					{ gridPos: second, index: 2 },
					{ gridPos: second, index: 0 },
				],
			);

			expect(resolveDragSelection(editor.state, { kind: 'block', pos: third })).toEqual([
				{ kind: 'block', pos: first },
				{ kind: 'gridColumns', gridPos: second, indices: [0, 2] },
				{ kind: 'block', pos: third },
			]);
		});
	});

	describe('selectBlockFromHandle', () => {
		it('selects an unselected block', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			expect(selectBlockFromHandle(editor.state, first)).toEqual({
				blocks: [first],
				gridColumns: [],
				anchor: first,
				columnAnchor: null,
			});
		});

		it('no-ops when the block is already the sole selection', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			expect(selectBlockFromHandle(editor.state, first)).toBeNull();
		});

		it('no-ops when the block is part of a multi-selection', () => {
			const [first, , third] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, third], first);
			expect(selectBlockFromHandle(editor.state, third)).toBeNull();
		});

		it('switches selection from a different block', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			expect(selectBlockFromHandle(editor.state, second)).toEqual({
				blocks: [second],
				gridColumns: [],
				anchor: second,
				columnAnchor: null,
			});
		});
	});

	describe('selectColumnFromHandle', () => {
		it('selects only the requested column', () => {
			expect(selectColumnFromHandle(editor.state, 4, 1)).toEqual({
				blocks: [],
				gridColumns: [{ gridPos: 4, index: 1 }],
				anchor: null,
				columnAnchor: { gridPos: 4, index: 1 },
			});
		});

		it('no-ops when the requested column is the sole selection', () => {
			const selection = selectColumnFromHandle(editor.state, 4, 1);
			expect(selection).not.toBeNull();
			if (selection) {
				editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, selection));
			}
			expect(selectColumnFromHandle(editor.state, 4, 1)).toBeNull();
		});

		it('no-ops when the requested column is part of a larger selection', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectMixed(
				editor,
				[first],
				[
					{ gridPos: 4, index: 0 },
					{ gridPos: 4, index: 1 },
				],
			);

			expect(selectColumnFromHandle(editor.state, 4, 1)).toBeNull();
		});
	});

	it('keeps the selection when an unrelated block is edited', () => {
		const [first] = topLevelBlockPositions(editor.state.doc);
		selectBlocks(editor, [first], first);
		editor.view.dispatch(editor.state.tr.insertText(' x', editor.state.doc.content.size - 1));
		expect(getSelectedBlockPositions(editor.state)).toEqual([first]);
	});

	it('drops a selected block once it is deleted', () => {
		const [, second, third] = topLevelBlockPositions(editor.state.doc);
		selectBlocks(editor, [second, third], second);
		editor.view.dispatch(editor.state.tr.delete(third, editor.state.doc.content.size));
		expect(getSelectedBlockPositions(editor.state)).toEqual([second]);
	});

	describe('grid column selection mapping', () => {
		let gridEditor: Editor;

		beforeEach(() => {
			gridEditor = createGridEditor();
		});

		afterEach(() => {
			gridEditor.destroy();
		});

		it('keeps selection when an unrelated edit maps the grid position', () => {
			const [, gridPos] = topLevelBlockPositions(gridEditor.state.doc);
			const selection = selectColumnFromHandle(gridEditor.state, gridPos, 0);
			expect(selection).not.toBeNull();
			if (selection) {
				gridEditor.view.dispatch(gridEditor.state.tr.setMeta(blockSelectionPluginKey, selection));
			}

			gridEditor.view.dispatch(gridEditor.state.tr.insertText('!', 2));

			expect(getSelectedGridColumns(gridEditor.state)).toEqual([{ gridPos: gridPos + 1, index: 0 }]);
			expect(blockSelectionPluginKey.getState(gridEditor.state)?.columnAnchor).toEqual({
				gridPos: gridPos + 1,
				index: 0,
			});
		});

		it('clears selection when the selected grid content changes', () => {
			const [, gridPos] = topLevelBlockPositions(gridEditor.state.doc);
			const selection = selectColumnFromHandle(gridEditor.state, gridPos, 0);
			expect(selection).not.toBeNull();
			if (selection) {
				gridEditor.view.dispatch(gridEditor.state.tr.setMeta(blockSelectionPluginKey, selection));
			}

			gridEditor.view.dispatch(gridEditor.state.tr.setNodeAttribute(gridPos, 'rawContent', FIRST_GRID_REORDERED));

			expect(getSelectedGridColumns(gridEditor.state)).toEqual([]);
			expect(blockSelectionPluginKey.getState(gridEditor.state)?.columnAnchor).toBeNull();
		});

		it('clears selection when the selected grid is deleted before an identical grid', () => {
			const identicalGridEditor = createGridEditor(FIRST_GRID);
			const [, firstGridPos] = topLevelBlockPositions(identicalGridEditor.state.doc);
			const selection = selectColumnFromHandle(identicalGridEditor.state, firstGridPos, 0);
			expect(selection).not.toBeNull();
			if (selection) {
				identicalGridEditor.view.dispatch(
					identicalGridEditor.state.tr.setMeta(blockSelectionPluginKey, selection),
				);
			}

			const firstGrid = identicalGridEditor.state.doc.nodeAt(firstGridPos);
			expect(firstGrid).not.toBeNull();
			if (firstGrid) {
				identicalGridEditor.view.dispatch(
					identicalGridEditor.state.tr.delete(firstGridPos, firstGridPos + firstGrid.nodeSize),
				);
			}

			expect(getSelectedGridColumns(identicalGridEditor.state)).toEqual([]);
			expect(blockSelectionPluginKey.getState(identicalGridEditor.state)?.columnAnchor).toBeNull();
			identicalGridEditor.destroy();
		});

		it('keeps selection in an unchanged grid when another grid changes', () => {
			const [, firstGridPos, secondGridPos] = topLevelBlockPositions(gridEditor.state.doc);
			const selection = selectColumnFromHandle(gridEditor.state, secondGridPos, 0);
			expect(selection).not.toBeNull();
			if (selection) {
				gridEditor.view.dispatch(gridEditor.state.tr.setMeta(blockSelectionPluginKey, selection));
			}

			gridEditor.view.dispatch(
				gridEditor.state.tr.setNodeAttribute(firstGridPos, 'rawContent', FIRST_GRID_REORDERED),
			);

			expect(getSelectedGridColumns(gridEditor.state)).toEqual([{ gridPos: secondGridPos, index: 0 }]);
			expect(blockSelectionPluginKey.getState(gridEditor.state)?.columnAnchor).toEqual({
				gridPos: secondGridPos,
				index: 0,
			});
		});
	});

	describe('isDropInsideSelection', () => {
		it('is true when dropping between two adjacent selected blocks', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			expect(isDropInsideSelection(editor.state.doc, second, [first, second])).toBe(true);
		});

		it('is false when dropping into the gap around an unselected middle block', () => {
			const [first, second, third] = topLevelBlockPositions(editor.state.doc);
			expect(isDropInsideSelection(editor.state.doc, second, [first, third])).toBe(false);
			expect(isDropInsideSelection(editor.state.doc, third, [first, third])).toBe(false);
		});

		it('is false when dropping outside the selection', () => {
			const [first, , third] = topLevelBlockPositions(editor.state.doc);
			expect(isDropInsideSelection(editor.state.doc, first, [first, third])).toBe(false);
			expect(isDropInsideSelection(editor.state.doc, editor.state.doc.content.size, [first, third])).toBe(false);
		});
	});

	describe('buildBlockMoveTransaction', () => {
		it('moves a non-contiguous selection around an unselected middle block', () => {
			const [a, , c] = topLevelBlockPositions(editor.state.doc);
			const move = buildBlockMoveTransaction(editor.state, [a, c], c);
			expect(move).not.toBeNull();
			if (!move) {
				return;
			}
			editor.view.dispatch(move.transaction);
			expect(editor.state.doc.childCount).toBe(3);
			expect(editor.state.doc.textContent).toBe('BBAACC');
		});

		it('moves a contiguous selection past a later block without dropping blocks', () => {
			const [a, b, c] = topLevelBlockPositions(editor.state.doc);
			const move = buildBlockMoveTransaction(editor.state, [a, b], c);
			expect(move).not.toBeNull();
			if (!move) {
				return;
			}
			editor.view.dispatch(move.transaction);
			expect(editor.state.doc.childCount).toBe(3);
			expect(editor.state.doc.textContent).toBe('AABBCC');
		});

		it('returns null when dropping between two adjacent selected blocks', () => {
			const [a, b] = topLevelBlockPositions(editor.state.doc);
			expect(buildBlockMoveTransaction(editor.state, [a, b], b)).toBeNull();
		});
	});

	describe('buildSelectionMoveTransaction', () => {
		it('moves a heading with two grid columns and collapses the remainder', () => {
			const moveEditor = createDocumentEditor([
				{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
				{ type: 'gridBlock', attrs: { rawContent: FIRST_THREE_COLUMN_GRID } },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] },
			]);
			const [headingPos, gridPos] = topLevelBlockPositions(moveEditor.state.doc);
			const move = buildSelectionMoveTransaction(
				moveEditor.state,
				[
					{ kind: 'block', pos: headingPos },
					{ kind: 'gridColumns', gridPos, indices: [0, 1] },
				],
				moveEditor.state.doc.content.size,
			);

			expect(move).not.toBeNull();
			if (move) {
				moveEditor.view.dispatch(move.transaction);
			}
			expect(moveEditor.state.doc.childCount).toBe(5);
			expect(moveEditor.state.doc.child(0).type.name).toBe('chartBlock');
			expect(moveEditor.state.doc.child(0).attrs.rawTag).toContain('query_id="q3"');
			expect(moveEditor.state.doc.child(2).type.name).toBe('heading');
			expect(moveEditor.state.doc.child(3).type.name).toBe('gridBlock');
			expect(splitGridColumnsRaw(moveEditor.state.doc.child(3).attrs.rawContent as string).columns).toHaveLength(
				2,
			);
			moveEditor.destroy();
		});

		it('moves selected column groups from two grids in document order', () => {
			const moveEditor = createDocumentEditor([
				{ type: 'gridBlock', attrs: { rawContent: FIRST_THREE_COLUMN_GRID } },
				{ type: 'gridBlock', attrs: { rawContent: SECOND_THREE_COLUMN_GRID } },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] },
			]);
			const [firstGridPos, secondGridPos] = topLevelBlockPositions(moveEditor.state.doc);
			const move = buildSelectionMoveTransaction(
				moveEditor.state,
				[
					{ kind: 'gridColumns', gridPos: firstGridPos, indices: [0, 1] },
					{ kind: 'gridColumns', gridPos: secondGridPos, indices: [0, 1] },
				],
				moveEditor.state.doc.content.size,
			);

			expect(move).not.toBeNull();
			if (move) {
				moveEditor.view.dispatch(move.transaction);
			}
			expect(moveEditor.state.doc.childCount).toBe(6);
			expect(moveEditor.state.doc.child(3).type.name).toBe('gridBlock');
			expect(moveEditor.state.doc.child(4).type.name).toBe('gridBlock');
			const firstMovedColumns = splitGridColumnsRaw(
				moveEditor.state.doc.child(3).attrs.rawContent as string,
			).columns;
			const secondMovedColumns = splitGridColumnsRaw(
				moveEditor.state.doc.child(4).attrs.rawContent as string,
			).columns;
			expect(firstMovedColumns).toHaveLength(2);
			expect(firstMovedColumns[0]).toContain('query_id="q1"');
			expect(secondMovedColumns).toHaveLength(2);
			expect(secondMovedColumns[0]).toContain('query_id="q4"');
			moveEditor.destroy();
		});

		it('moves a fully selected grid and deletes its source', () => {
			const moveEditor = createDocumentEditor([
				{ type: 'gridBlock', attrs: { rawContent: FIRST_THREE_COLUMN_GRID } },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] },
			]);
			const [gridPos] = topLevelBlockPositions(moveEditor.state.doc);
			const move = buildSelectionMoveTransaction(
				moveEditor.state,
				[{ kind: 'gridColumns', gridPos, indices: [0, 1, 2] }],
				moveEditor.state.doc.content.size,
			);

			expect(move).not.toBeNull();
			if (move) {
				moveEditor.view.dispatch(move.transaction);
			}
			expect(moveEditor.state.doc.childCount).toBe(3);
			expect(moveEditor.state.doc.child(0).type.name).toBe('paragraph');
			expect(moveEditor.state.doc.child(1).type.name).toBe('gridBlock');
			expect(splitGridColumnsRaw(moveEditor.state.doc.child(1).attrs.rawContent as string).columns).toHaveLength(
				3,
			);
			moveEditor.destroy();
		});

		it('returns null when dropping between adjacent selected units', () => {
			const [first, second] = topLevelBlockPositions(editor.state.doc);
			expect(
				buildSelectionMoveTransaction(
					editor.state,
					[
						{ kind: 'block', pos: first },
						{ kind: 'block', pos: second },
					],
					second,
				),
			).toBeNull();
		});
	});

	describe('clearing from outside the editor', () => {
		it('clears the selection on Escape', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			expect(getSelectedBlockPositions(editor.state)).toEqual([]);
		});

		it('clears the selection when clicking outside the editor content', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			const outside = document.createElement('div');
			document.body.appendChild(outside);
			outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			expect(getSelectedBlockPositions(editor.state)).toEqual([]);
			outside.remove();
		});
	});
});
