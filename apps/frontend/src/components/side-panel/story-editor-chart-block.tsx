import { parseChartBlock, TAG_ATTRS } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useCallback, useContext, useMemo } from 'react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryBlockDragGrip, StoryBlockDropZones, useStoryBlockDrag } from './story-editor-block-drag';
import { SelectedBlockPositionsContext } from './story-block-selection-context';
import { decodeFromAttr } from './story-editor-utils';
import type { ReactNodeViewProps } from '@tiptap/react';
import { EditorStoryChartEditProvider } from '@/contexts/story-chart-edit';

function ChartBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const chart = useMemo(() => {
		const attrMatch = rawTag.match(new RegExp(`<chart\\s+(${TAG_ATTRS})\\/?>`));
		if (!attrMatch) {
			return null;
		}
		const parsed = parseChartBlock(attrMatch[1]);
		return parsed ? { ...parsed, rawTag } : null;
	}, [rawTag]);
	const { handleDragStart, handleDragEnd } = useStoryBlockDrag({ node, editor, getPos });
	const selectedBlocks = useContext(SelectedBlockPositionsContext);
	const pos = getPos();
	const isSelected = typeof pos === 'number' && selectedBlocks.includes(pos);

	const handleReplaceTag = useCallback(
		(_rawTag: string, nextTag: string) => updateAttributes({ rawTag: nextTag }),
		[updateAttributes],
	);

	if (!chart) {
		return (
			<NodeViewWrapper draggable data-type='chart-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid chart block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='chart-block'>
			<div className='group relative my-2' draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<div contentEditable={false} className='absolute -left-10 top-2 z-20'>
					<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />
				</div>
				<EditorStoryChartEditProvider onReplaceTag={handleReplaceTag}>
					<StoryChartEmbed chart={chart} isSelected={isSelected} />
				</EditorStoryChartEditProvider>
			</div>
		</NodeViewWrapper>
	);
}

export const ChartBlock = Node.create({
	name: 'chartBlock',
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
				tag: 'chart-embed',
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
		return ['chart-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(ChartBlockView);
	},

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});
