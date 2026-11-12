import { Extension } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { ChangeSet, simplifyChanges } from '@tiptap/pm/changeset';
import { Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function MarkdownRenderedDiff({ oldMarkdown, newMarkdown }: { oldMarkdown: string; newMarkdown: string }) {
	const editor = useEditor(
		{
			editable: false,
			extensions: [
				StarterKit.configure({ link: { openOnClick: false } }),
				TableKit,
				Markdown.configure({ markedOptions: { gfm: true } }),
				MarkdownDiffDecorations.configure({ oldMarkdown }),
			],
			content: newMarkdown,
			contentType: 'markdown',
		},
		[oldMarkdown, newMarkdown],
	);

	return (
		<EditorContent
			editor={editor}
			aria-label='Rendered changes'
			className='markdown-file-editor markdown-rendered-diff mx-auto max-w-3xl px-8 py-6'
		/>
	);
}

const MarkdownDiffDecorations = Extension.create<{ oldMarkdown: string }>({
	name: 'markdownDiffDecorations',

	addOptions() {
		return { oldMarkdown: '' };
	},

	addProseMirrorPlugins() {
		const { editor } = this;
		const { oldMarkdown } = this.options;
		let cached: { doc: ProseMirrorNode; decorations: DecorationSet } | null = null;

		return [
			new Plugin({
				props: {
					decorations: (state) => {
						if (!editor.markdown) {
							return DecorationSet.empty;
						}
						if (cached?.doc !== state.doc) {
							const oldDoc = state.schema.nodeFromJSON(editor.markdown.parse(oldMarkdown));
							cached = { doc: state.doc, decorations: getDiffDecorations(oldDoc, state.doc) };
						}
						return cached.decorations;
					},
				},
			}),
		];
	},
});

/** Marks what the new document adds, and shows what it removed where it used to be. */
function getDiffDecorations(oldDoc: ProseMirrorNode, newDoc: ProseMirrorNode): DecorationSet {
	const replaceAll = new ReplaceStep(0, oldDoc.content.size, new Slice(newDoc.content, 0, 0));
	const changeSet = ChangeSet.create(oldDoc).addSteps(newDoc, [replaceAll.getMap()], null);
	const decorations: Decoration[] = [];

	for (const change of simplifyChanges(changeSet.changes, newDoc)) {
		if (change.toA > change.fromA) {
			const removedText = oldDoc.textBetween(change.fromA, change.toA, '\n', ' ');
			const isBetweenBlocks = newDoc.resolve(change.fromB).parent === newDoc;
			decorations.push(
				Decoration.widget(change.fromB, () => createRemovedText(removedText, isBetweenBlocks), {
					side: -1,
					marks: [],
				}),
			);
		}
		if (change.toB > change.fromB) {
			decorations.push(...getAddedDecorations(newDoc, change.fromB, change.toB));
		}
	}
	return DecorationSet.create(newDoc, decorations);
}

/** Whole added blocks are highlighted as blocks, and added text inside a block as text. */
function getAddedDecorations(doc: ProseMirrorNode, from: number, to: number): Decoration[] {
	const decorations: Decoration[] = [Decoration.inline(from, to, { class: 'markdown-diff-added' })];
	doc.nodesBetween(from, to, (node, position) => {
		if (node.isBlock && position >= from && position + node.nodeSize <= to) {
			decorations.push(
				Decoration.node(position, position + node.nodeSize, { class: 'markdown-diff-added-block' }),
			);
			return false;
		}
		return true;
	});
	return decorations;
}

function createRemovedText(text: string, isBlock: boolean): HTMLElement {
	const removed = document.createElement('del');
	removed.className = isBlock ? 'markdown-diff-removed markdown-diff-removed-block' : 'markdown-diff-removed';
	removed.textContent = text;
	return removed;
}
