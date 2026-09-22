import { Extension } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { BlockSelection } from './story-block-selection';
import { ChartBlock } from './story-editor-chart-block';
import { GridBlock } from './story-editor-grid-block';
import { MapBlock } from './story-editor-map-block';
import { TableBlock } from './story-editor-table-block';
import type { Editor as CoreEditor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

// ProseMirror's table plugin intercepts Backspace/Delete to handle cell
// operations, which prevents deletion of the table node itself. This
// extension runs at higher priority so its shortcuts fire first:
//   - Backspace/Delete in an empty table → remove the table
//   - Mod-Shift-Backspace in any table   → force-remove the table
const TableDeleteShortcuts = Extension.create({
	name: 'tableDeleteShortcuts',
	priority: 150,

	addKeyboardShortcuts() {
		const findEnclosingTable = (editor: CoreEditor) => {
			const { $anchor } = editor.state.selection;
			for (let depth = $anchor.depth; depth > 0; depth--) {
				const node = $anchor.node(depth);
				if (node.type.name === 'table') {
					return node;
				}
			}
			return null;
		};

		// A table is "empty" only if it has no meaningful content — text counts,
		// as do embedded atom/leaf nodes (charts, tables, images). Empty paragraph
		// placeholders that cells always contain are ignored.
		const isTableEmpty = (table: PMNode): boolean => {
			let hasContent = false;
			table.descendants((descendant) => {
				if (hasContent) {
					return false;
				}
				if (descendant.isText) {
					if (descendant.text?.trim()) {
						hasContent = true;
					}
					return false;
				}
				if (descendant.isAtom || descendant.isLeaf) {
					hasContent = true;
					return false;
				}
				return true;
			});
			return !hasContent;
		};

		const deleteIfEmpty = ({ editor }: { editor: CoreEditor }): boolean => {
			const table = findEnclosingTable(editor);
			if (table && isTableEmpty(table)) {
				return editor.commands.deleteTable();
			}
			return false;
		};

		return {
			Backspace: deleteIfEmpty,
			Delete: deleteIfEmpty,
			'Mod-Shift-Backspace': ({ editor }) => {
				if (findEnclosingTable(editor)) {
					return editor.commands.deleteTable();
				}
				return false;
			},
		};
	},
});

export const EDITOR_EXTENSIONS = [
	StarterKit.configure({
		dropcursor: { width: 2, color: 'var(--primary-muted)', class: 'drop-cursor' },
	}),
	TableKit,
	TableDeleteShortcuts,
	Markdown.configure({
		markedOptions: {
			gfm: true,
		},
	}),
	ChartBlock,
	TableBlock,
	MapBlock,
	GridBlock,
	BlockSelection,
];
