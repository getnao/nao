import { memo, useMemo, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Streamdown } from 'streamdown';
import { GripVertical } from 'lucide-react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryTableEmbed } from './story-table-embed';
import type { ReactNodeViewProps, Editor } from '@tiptap/react';
import type { Segment } from '@/lib/story-segments';
import {
	getGridClass,
	parseChartAttributes,
	parseChartBlock,
	parseTableBlock,
	splitCodeIntoSegments,
} from '@/lib/story-segments';

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
 * Replaces custom <chart />, <table /> and <grid> tags with HTML-safe elements that
 * Tiptap's DOMParser can match against custom node extensions.
 */
export function preprocessForEditor(code: string): string {
	let result = code.replace(/<grid\s+[^>]*>[\s\S]*?<\/grid>/g, (match) => {
		return `<grid-embed data-raw="${encodeForAttr(match)}"></grid-embed>`;
	});

	result = result.replace(/<chart\s+[^/>]*\/?>/g, (match) => {
		return `<chart-embed data-raw="${encodeForAttr(match)}"></chart-embed>`;
	});

	result = result.replace(/<table\s+[^/>]*\/?>/g, (match) => {
		return `<table-embed data-raw="${encodeForAttr(match)}"></table-embed>`;
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
			<NodeViewWrapper draggable data-type='chart-block'>
				<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
					Invalid chart block
				</div>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper draggable data-type='chart-block'>
			<div className='my-2'>
				<StoryChartEmbed chart={chart} />
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

	renderMarkdown(node) {
		const rawTag = typeof node.attrs?.rawTag === 'string' ? node.attrs.rawTag : '';
		return `${rawTag}\n\n`;
	},
});

// ---------------------------------------------------------------------------
// TableBlock extension – atom node rendered as a SQL table
// ---------------------------------------------------------------------------

function TableBlockView({ node }: ReactNodeViewProps) {
	const rawTag = node.attrs.rawTag as string;

	const table = useMemo(() => {
		const attrMatch = rawTag.match(/<table\s+([^/>]*)\/?>/);
		if (!attrMatch) {
			return null;
		}
		return parseTableBlock(attrMatch[1]);
	}, [rawTag]);

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
			<div className='my-2'>
				<StoryTableEmbed table={table} />
			</div>
		</NodeViewWrapper>
	);
}

const TableBlock = Node.create({
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

// ---------------------------------------------------------------------------
// GridBlock extension – atom node rendered as a grid of charts/markdown
// ---------------------------------------------------------------------------

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

	const gridClass = getGridClass(cols);

	return (
		<NodeViewWrapper draggable data-type='grid-block'>
			<div className='@container my-2'>
				<div className={`grid ${gridClass} gap-4`}>
					{segments.map((segment, i) => (
						<div key={i} className='min-w-0'>
							{segment.type === 'markdown' ? (
								<Streamdown mode='static'>{segment.content}</Streamdown>
							) : segment.type === 'chart' ? (
								<StoryChartEmbed chart={segment.chart} />
							) : segment.type === 'table' ? (
								<StoryTableEmbed table={segment.table} />
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
	draggable: true,

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

	renderMarkdown(node) {
		const rawContent = typeof node.attrs?.rawContent === 'string' ? node.attrs.rawContent : '';
		return `${rawContent}\n\n`;
	},
});

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

const EDITOR_EXTENSIONS = [
	StarterKit.configure({
		dropcursor: { width: 3, class: 'drop-cursor' },
	}),
	TableKit,
	Markdown.configure({
		markedOptions: {
			gfm: true,
		},
	}),
	ChartBlock,
	TableBlock,
	GridBlock,
];

interface StoryEditorProps {
	code: string;
	editorRef: React.MutableRefObject<Editor | null>;
}

export const StoryEditor = memo(function StoryEditor({ code, editorRef }: StoryEditorProps) {
	const processedContent = useMemo(() => preprocessForEditor(code), [code]);

	const editor = useEditor({
		extensions: EDITOR_EXTENSIONS,
		content: processedContent,
		contentType: 'markdown',
	});

	useEffect(() => {
		editorRef.current = editor;
		return () => {
			editorRef.current = null;
		};
	}, [editor, editorRef]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		if (getEditorMarkdown(editor) === code) {
			return;
		}
		editor.commands.setContent(processedContent, { emitUpdate: false, contentType: 'markdown' });
	}, [editor, code, processedContent]);

	return (
		<div className='story-editor relative'>
			{editor && (
				<DragHandle editor={editor} className='drag-handle'>
					<div className='drag-handle-button'>
						<GripVertical className='size-4' />
					</div>
				</DragHandle>
			)}
			<EditorContent editor={editor} />
		</div>
	);
});

export function getEditorMarkdown(editor: Editor): string {
	return editor.getMarkdown();
}
