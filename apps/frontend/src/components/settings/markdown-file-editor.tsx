import { Extension } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ReactNode, RefObject } from 'react';

import type { MarkdownLayout, MarkdownToken } from '@/lib/markdown-blocks';
import { usePreviewHighlights } from '@/hooks/use-preview-highlights';
import { containsTokenType, getMarkdownLayout, writeMarkdownBlocks } from '@/lib/markdown-blocks';
import { cn } from '@/lib/utils';

/** Blocks the editor turns back into the same Markdown; other blocks (HTML, link definitions, …) would be lost. */
const EDITABLE_BLOCK_TYPES = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'hr', 'table']);

interface MarkdownSource {
	markdown: string;
	layout: MarkdownLayout;
	canonicals: string[];
}

interface MarkdownFileEditorProps {
	value: string;
	filePath: string;
	searchQuery: string;
	onChange: (markdown: string) => void;
	onSave: () => void;
	/** Shown instead of the editor when the file holds Markdown the editor could not write back. */
	fallback: ReactNode;
	/** Shown above the content and scrolling with it, like the properties of the file. */
	header?: ReactNode;
}

/**
 * Edits a Markdown file as it renders. Only the blocks the user changes are rewritten, so the rest of the file keeps
 * the exact Markdown it was written with.
 */
export function MarkdownFileEditor({
	value,
	filePath,
	searchQuery,
	onChange,
	onSave,
	fallback,
	header,
}: MarkdownFileEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onChangeRef = useLatestRef(onChange);
	const onSaveRef = useLatestRef(onSave);
	const sourceRef = useRef<MarkdownSource | null>(null);
	const editorMarkdownRef = useRef<string | null>(null);
	const [isEditable, setIsEditable] = useState(true);
	const extensions = useMemo(() => createMarkdownExtensions(onSaveRef), [onSaveRef]);

	const adoptSource = useCallback((editor: Editor, markdown: string) => {
		const source = readMarkdownSource(editor, markdown);
		sourceRef.current = source;
		editorMarkdownRef.current = markdown;
		setIsEditable(source !== null);
	}, []);

	const editor = useEditor({
		extensions,
		content: value,
		contentType: 'markdown',
		onCreate: ({ editor: createdEditor }) => adoptSource(createdEditor, value),
		onUpdate: ({ editor: updatedEditor }) => {
			const source = sourceRef.current;
			if (!source) {
				return;
			}
			const markdown = writeMarkdownBlocks(
				source.layout,
				source.canonicals,
				serializeTopLevelBlocks(updatedEditor),
			);
			editorMarkdownRef.current = markdown;
			onChangeRef.current(markdown);
		},
	});

	useEffect(() => {
		if (!editor || value === editorMarkdownRef.current) {
			return;
		}
		editor.commands.setContent(value, { emitUpdate: false, contentType: 'markdown' });
		adoptSource(editor, value);
	}, [adoptSource, editor, value]);

	usePreviewHighlights({ containerRef, content: value, filePath, searchQuery });

	if (!isEditable) {
		return (
			<div className='flex h-full min-h-0 flex-col'>
				<p className='shrink-0 border-b px-4 py-1.5 text-xs text-muted-foreground'>
					This file uses Markdown the visual editor cannot keep, like HTML or link definitions. Edit it in
					Source.
				</p>
				<div className='min-h-0 flex-1'>{fallback}</div>
			</div>
		);
	}

	return (
		<section aria-label='Markdown preview' className='flex h-full min-h-0 flex-col'>
			<div ref={containerRef} className='min-h-0 flex-1 overflow-auto'>
				{header && <div className='mx-auto max-w-3xl px-8 pt-6'>{header}</div>}
				<EditorContent
					editor={editor}
					aria-label='Markdown editor'
					className={cn('markdown-file-editor mx-auto max-w-3xl px-8 py-6', header && 'pt-2')}
				/>
			</div>
		</section>
	);
}

function createMarkdownExtensions(onSaveRef: RefObject<() => void>) {
	return [
		StarterKit.configure({ link: { openOnClick: false } }),
		TableKit,
		Markdown.configure({ markedOptions: { gfm: true } }),
		Extension.create({
			name: 'saveShortcut',
			addKeyboardShortcuts: () => ({
				'Mod-s': () => {
					onSaveRef.current();
					return true;
				},
			}),
		}),
	];
}

/** The source as blocks, with each block as the editor writes it, or null when a block would not survive editing. */
function readMarkdownSource(editor: Editor, markdown: string): MarkdownSource | null {
	const markdownManager = editor.markdown;
	if (!markdownManager) {
		return null;
	}
	const tokens = markdownManager.instance.lexer(markdown) as MarkdownToken[];
	const layout = getMarkdownLayout(tokens);
	const canonicals = serializeTopLevelBlocks(editor);
	const isEditable =
		layout.blocks.every((block) => EDITABLE_BLOCK_TYPES.has(block.type)) &&
		!containsTokenType(tokens, 'html') &&
		canonicals.length === layout.blocks.length;
	return isEditable ? { markdown, layout, canonicals } : null;
}

const serializedBlocks = new WeakMap<ProseMirrorNode, string>();

/** Each non-empty top-level block of the editor as Markdown; unchanged blocks are cached by node identity. */
function serializeTopLevelBlocks(editor: Editor): string[] {
	const markdownManager = editor.markdown;
	if (!markdownManager) {
		return [];
	}
	const blocks: string[] = [];
	editor.state.doc.forEach((node) => {
		let block = serializedBlocks.get(node);
		if (block === undefined) {
			block = markdownManager.serialize({ type: 'doc', content: [node.toJSON()] }).trim();
			serializedBlocks.set(node, block);
		}
		if (block) {
			blocks.push(block);
		}
	});
	return blocks;
}

function useLatestRef<Value>(value: Value): RefObject<Value> {
	const ref = useRef(value);
	ref.current = value;
	return ref;
}
