import { parseTableBlock, TAG_ATTRS } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useMemo } from 'react';
import { StoryTableEmbed } from './story-table-embed';
import { StoryBlockDragGrip, StoryBlockDropZones, useStoryBlockDrag } from './story-editor-block-drag';
import { decodeFromAttr } from './story-editor-utils';
import type { ReactNodeViewProps } from '@tiptap/react';

function TableBlockView({ node, editor, getPos }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const table = useMemo(() => {
		const attrMatch = rawTag.match(new RegExp(`<table\\s+(${TAG_ATTRS})\\/?>`));
		if (!attrMatch) {
			return null;
		}
		const parsed = parseTableBlock(attrMatch[1]);
		return parsed ? { ...parsed, rawTag } : null;
	}, [rawTag]);
	const { handleDragStart, handleDragEnd } = useStoryBlockDrag({ node, editor, getPos });

	if (!table) {
		return (
			<NodeViewWrapper draggable data-type='table-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid table block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='table-block'>
			<div className='group relative my-2' draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<div contentEditable={false} className='absolute -left-10 top-2 z-20'>
					<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />
				</div>
				<StoryTableEmbed table={table} />
			</div>
		</NodeViewWrapper>
	);
}

export const TableBlock = Node.create({
	name: 'tableBlock',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			rawTag: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'table-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					return { rawTag: decodeFromAttr(encoded) };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['table-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(TableBlockView);
	},

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});
