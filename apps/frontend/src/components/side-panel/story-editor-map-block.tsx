import { parseMapBlock, TAG_ATTRS } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useCallback, useMemo } from 'react';
import { StoryMapEmbed } from './story-map-embed';
import { StoryBlockDragGrip, StoryBlockDropZones } from './story-editor-block-drag';
import { decodeFromAttr } from './story-editor-utils';
import type { ReactNodeViewProps } from '@tiptap/react';
import { EditorStoryMapEditProvider } from '@/contexts/story-map-edit';

function MapBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const map = useMemo(() => {
		const attrMatch = rawTag.match(new RegExp(`<map\\s+(${TAG_ATTRS})\\/?>`));
		if (!attrMatch) {
			return null;
		}
		const parsed = parseMapBlock(attrMatch[1]);
		return parsed ? { ...parsed, rawTag } : null;
	}, [rawTag]);

	const handleReplaceTag = useCallback(
		(_rawTag: string, nextTag: string) => updateAttributes({ rawTag: nextTag }),
		[updateAttributes],
	);

	if (!map) {
		return (
			<NodeViewWrapper draggable data-type='map-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid map block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='map-block'>
			<div className='group relative my-2'>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<EditorStoryMapEditProvider onReplaceTag={handleReplaceTag}>
					<StoryMapEmbed
						map={map}
						dragHandle={<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />}
					/>
				</EditorStoryMapEditProvider>
			</div>
		</NodeViewWrapper>
	);
}

export const MapBlock = Node.create({
	name: 'mapBlock',
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
				tag: 'map-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					const rawTag = encoded ? decodeFromAttr(encoded) : element.getAttribute('rawTag') || '';
					return { rawTag };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['map-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(MapBlockView);
	},

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});
