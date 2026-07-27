// @vitest-environment jsdom

import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	BlockSelection,
	blockSelectionPluginKey,
	buildBlockMoveTransaction,
	emptySelection,
	getSelectedBlockPositions,
	getSelectedGridColumns,
	isDropInsideSelection,
	rangeBetween,
	resolveDragBlocks,
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

const FIRST_GRID = '<grid><chart query_id="q1" chart_type="line" x_axis_key="month" /></grid>';
const FIRST_GRID_REORDERED = '<grid><chart query_id="q1" chart_type="bar" x_axis_key="month" /></grid>';
const SECOND_GRID = '<grid><chart query_id="q2" chart_type="bar" x_axis_key="month" /></grid>';

function createGridEditor(): Editor {
	return new Editor({
		extensions: [StarterKit, TestGridBlock, BlockSelection],
		content: {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
				{ type: 'gridBlock', attrs: { rawContent: FIRST_GRID } },
				{ type: 'gridBlock', attrs: { rawContent: SECOND_GRID } },
				{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
			],
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

		it('toggles grid columns with the modifier key', () => {
			const column = document.createElement('div');
			column.setAttribute('data-grid-column', '');
			column.setAttribute('data-grid-pos', '4');
			column.setAttribute('data-col-index', '1');
			editor.view.dom.appendChild(column);

			dispatchEditorMouseDown(column, { ctrlKey: true });
			expect(getSelectedGridColumns(editor.state)).toEqual([{ gridPos: 4, index: 1 }]);

			dispatchEditorMouseDown(column, { ctrlKey: true });
			expect(getSelectedGridColumns(editor.state)).toEqual([]);
		});

		it('selects a grid-column range from the column anchor', () => {
			const first = document.createElement('div');
			first.setAttribute('data-grid-column', '');
			first.setAttribute('data-grid-pos', '4');
			first.setAttribute('data-col-index', '0');
			const third = document.createElement('div');
			third.setAttribute('data-grid-column', '');
			third.setAttribute('data-grid-pos', '4');
			third.setAttribute('data-col-index', '2');
			editor.view.dom.append(first, third);

			dispatchEditorMouseDown(first, { ctrlKey: true });
			dispatchEditorMouseDown(third, { shiftKey: true });

			expect(getSelectedGridColumns(editor.state)).toEqual([
				{ gridPos: 4, index: 0 },
				{ gridPos: 4, index: 1 },
				{ gridPos: 4, index: 2 },
			]);
		});
	});

	describe('resolveDragBlocks', () => {
		it('resolves an unselected block as a single drag', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			expect(resolveDragBlocks(editor.state, first)).toEqual({
				positions: [first],
				isMulti: false,
			});
		});

		it('resolves a single selected block as a single drag', () => {
			const [first] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first], first);
			expect(resolveDragBlocks(editor.state, first)).toEqual({
				positions: [first],
				isMulti: false,
			});
		});

		it('resolves and sorts a multi-selection containing the dragged block', () => {
			const [first, second, third] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [third, first, second], third);
			expect(resolveDragBlocks(editor.state, second)).toEqual({
				positions: [first, second, third],
				isMulti: true,
			});
		});

		it('resolves a block outside a multi-selection as a single drag', () => {
			const [first, second, third] = topLevelBlockPositions(editor.state.doc);
			selectBlocks(editor, [first, third], first);
			expect(resolveDragBlocks(editor.state, second)).toEqual({
				positions: [second],
				isMulti: false,
			});
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
