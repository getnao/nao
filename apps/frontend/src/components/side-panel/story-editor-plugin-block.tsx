import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Blocks } from 'lucide-react';
import { useMemo } from 'react';
import { StoryBlockDragGrip, StoryBlockDropZones, useStoryBlockDrag } from './story-editor-block-drag';
import { decodeFromAttr } from './story-editor-utils';
import type { ParsedPluginBlock } from '@nao/shared/story-segments';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

function PluginBlockView({ node, editor, getPos }: ReactNodeViewProps) {
	const rawContent = node.attrs.rawContent as string;
	const plugin = useMemo(() => parsePlugin(rawContent), [rawContent]);
	const { handleDragStart, handleDragEnd } = useStoryBlockDrag({ node, editor, getPos });

	return (
		<NodeViewWrapper draggable data-type='plugin-block'>
			<div className='group relative my-2' draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
				<StoryBlockDropZones node={node} editor={editor} getPos={getPos} />
				<div contentEditable={false} className='absolute -left-10 top-2 z-20'>
					<StoryBlockDragGrip node={node} editor={editor} getPos={getPos} />
				</div>
				{plugin ? (
					<StoryPluginPlaceholder plugin={plugin} />
				) : (
					<div className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
						Invalid plugin block
					</div>
				)}
			</div>
		</NodeViewWrapper>
	);
}

export function StoryPluginPlaceholder({ plugin, dragHandle }: { plugin: ParsedPluginBlock; dragHandle?: ReactNode }) {
	return (
		<div className='flex min-h-32 flex-col justify-between gap-4 rounded-lg border bg-card p-4'>
			<div className='flex items-center justify-between gap-2'>
				<div className='flex min-w-0 items-center gap-2'>
					<Blocks className='size-4 shrink-0 text-muted-foreground' />
					<span className='truncate text-sm font-medium text-foreground'>
						{plugin.title ?? 'Vibe coded plugin'}
					</span>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					<Badge variant='secondary'>Plugin</Badge>
					{dragHandle}
				</div>
			</div>
			<p className='text-sm text-muted-foreground'>Interactive plugin preview is available in story view.</p>
		</div>
	);
}

export const PluginBlock = Node.create({
	name: 'pluginBlock',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			rawContent: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'plugin-embed',
				getAttrs(element) {
					if (typeof element === 'string') {
						return false;
					}
					const encoded = element.getAttribute('data-raw') || '';
					return { rawContent: decodeFromAttr(encoded) };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['plugin-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(PluginBlockView);
	},

	renderMarkdown(node) {
		const rawContent = typeof node.attrs?.rawContent === 'string' ? node.attrs.rawContent : '';
		return `${rawContent}\n\n`;
	},
});

function parsePlugin(rawContent: string): ParsedPluginBlock | null {
	const segment = splitCodeIntoSegments(rawContent).find((item) => item.type === 'plugin');
	return segment?.type === 'plugin' ? segment.plugin : null;
}
