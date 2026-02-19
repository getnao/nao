import { useMemo, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Streamdown } from 'streamdown';
import { ArtifactChartEmbed } from './artifact-chart-embed';
import type { ReactNodeViewProps, Editor } from '@tiptap/react';
import type { Segment } from '@/lib/artifact-segments';
import { parseChartAttributes, parseChartBlock, splitCodeIntoSegments } from '@/lib/artifact-segments';

// ---------------------------------------------------------------------------
// Encoding helpers for data-raw attributes
// ---------------------------------------------------------------------------

function encodeForAttr(str: string): string {
	return btoa(encodeURIComponent(str));
}

function decodeFromAttr(encoded: string): string {
	return decodeURIComponent(atob(encoded));
}

/**
 * Replaces custom <chart /> and <grid> tags with HTML-safe elements that
 * Tiptap's DOMParser can match against custom node extensions.
 */
export function preprocessForEditor(code: string): string {
	let result = code.replace(/<grid\s+[^>]*>[\s\S]*?<\/grid>/g, (match) => {
		return `<grid-embed data-raw="${encodeForAttr(match)}"></grid-embed>`;
	});

	result = result.replace(/<chart\s+[^/>]*\/?>/g, (match) => {
		return `<chart-embed data-raw="${encodeForAttr(match)}"></chart-embed>`;
	});

	return result;
}

// ---------------------------------------------------------------------------
// ChartBlock extension – atom node rendered as an interactive chart
// ---------------------------------------------------------------------------

function ChartBlockView({ node }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const chart = useMemo(() => {
		const attrMatch = rawTag.match(/<chart\s+([^/>]*)\/?>/);
		if (!attrMatch) {
			return null;
		}
		return parseChartBlock(attrMatch[1]);
	}, [rawTag]);

	if (!chart) {
		return (
			<NodeViewWrapper data-type='chart-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid chart block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper data-type='chart-block'>
			<div className='my-2'>
				<ArtifactChartEmbed chart={chart} />
			</div>
		</NodeViewWrapper>
	);
}

const ChartBlock = Node.create({
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

	addStorage() {
		return {
			markdown: {
				serialize(state: any, node: any) {
					state.write(node.attrs.rawTag);
					state.closeBlock(node);
				},
				parse: {},
			},
		};
	},
});

// ---------------------------------------------------------------------------
// GridBlock extension – atom node rendered as a grid of charts/markdown
// ---------------------------------------------------------------------------

const GRID_CLASSES: Record<number, string> = {
	1: 'grid-cols-1',
	2: 'grid-cols-1 @sm:grid-cols-2',
	3: 'grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3',
	4: 'grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4',
};

function GridBlockView({ node }: ReactNodeViewProps) {
	const rawContent = node.attrs.rawContent as string;

	const { cols, segments } = useMemo(() => {
		const gridMatch = rawContent.match(/<grid\s+([^>]*)>([\s\S]*?)<\/grid>/);
		if (!gridMatch) {
			return { cols: 2, segments: [] as Segment[] };
		}
		const attrs = parseChartAttributes(gridMatch[1]);
		return {
			cols: parseInt(attrs.cols || '2', 10),
			segments: splitCodeIntoSegments(gridMatch[2]),
		};
	}, [rawContent]);

	const gridClass = GRID_CLASSES[Math.min(cols, 4)] ?? GRID_CLASSES[2];

	return (
		<NodeViewWrapper data-type='grid-block'>
			<div className='@container my-2'>
				<div className={`grid ${gridClass} gap-4`}>
					{segments.map((segment, i) => (
						<div key={i} className='min-w-0'>
							{segment.type === 'markdown' ? (
								<Streamdown mode='static'>{segment.content}</Streamdown>
							) : segment.type === 'chart' ? (
								<ArtifactChartEmbed chart={segment.chart} />
							) : null}
						</div>
					))}
				</div>
			</div>
		</NodeViewWrapper>
	);
}

const GridBlock = Node.create({
	name: 'gridBlock',
	group: 'block',
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			rawContent: { default: '' },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'grid-embed',
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
		return ['grid-embed', mergeAttributes(HTMLAttributes)];
	},

	addNodeView() {
		return ReactNodeViewRenderer(GridBlockView);
	},

	addStorage() {
		return {
			markdown: {
				serialize(state: any, node: any) {
					state.write(node.attrs.rawContent);
					state.closeBlock(node);
				},
				parse: {},
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

interface ArtifactEditorProps {
	code: string;
	editorRef: React.MutableRefObject<Editor | null>;
}

export function ArtifactEditor({ code, editorRef }: ArtifactEditorProps) {
	const processedContent = useMemo(() => preprocessForEditor(code), [code]);

	const editor = useEditor({
		extensions: [
			StarterKit,
			Markdown.configure({
				html: true,
				transformPastedText: true,
				transformCopiedText: true,
			}),
			ChartBlock,
			GridBlock,
		],
		content: processedContent,
	});

	useEffect(() => {
		editorRef.current = editor;
		return () => {
			editorRef.current = null;
		};
	}, [editor, editorRef]);

	return (
		<div className='artifact-editor p-6'>
			<EditorContent editor={editor} />
		</div>
	);
}

export function getEditorMarkdown(editor: Editor): string {
	const storage = editor.storage as Record<string, any>;
	return storage.markdown.getMarkdown();
}
