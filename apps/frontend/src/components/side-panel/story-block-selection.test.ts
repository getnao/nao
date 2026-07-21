// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	BlockSelection,
	blockSelectionPluginKey,
	buildBlockMoveTransaction,
	getSelectedBlockPositions,
	isDropInsideSelection,
	rangeBetween,
	topLevelBlockPositions,
} from './story-block-selection';

function createEditor(): Editor {
	return new Editor({
		extensions: [StarterKit, BlockSelection],
		content: '<p>AA</p><p>BB</p><p>CC</p>',
	});
}

function selectBlocks(editor: Editor, blocks: number[], anchor: number | null): void {
	editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, { blocks, anchor }));
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
