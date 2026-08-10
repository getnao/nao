import { getGridClass, getGridTemplateColumns } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { GripVertical } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useContext } from 'react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryMapEmbed } from './story-map-embed';
import { StoryTableEmbed } from './story-table-embed';
import { blockSelectionPluginKey, selectColumnFromHandle } from './story-block-selection';
import { BlockSelectionContext } from './story-block-selection-context';
import { StoryBlockDragContext } from './story-editor-drag-context';
import { decodeFromAttr } from './story-editor-utils';
import { useStoryEditorGridBlock } from './hooks/use-story-editor-grid-block';
import type { Segment } from '@nao/shared/story-segments';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { ReactNode } from 'react';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { EditorStoryChartEditProvider } from '@/contexts/story-chart-edit';
import { EditorStoryMapEditProvider } from '@/contexts/story-map-edit';
import { markdownPlugins } from '@/lib/markdown';
import { cn } from '@/lib/utils';

const markdownComponents = { table: ({ node, className }: any) => <MarkdownTable node={node} className={className} /> };

/**
 * Renders a single grid column's content in the editor. Charts/tables receive
 * the column drag handle; nested grids render recursively so their content
 * stays visible while editing.
 */
function renderColumnContent(
	segment: Segment,
	dragHandle: ReactNode,
	onReplaceTag: (rawTag: string, nextTag: string) => void,
	dragHandlePlacement: 'leading' | 'trailing' = 'trailing',
	isSelected: boolean = false,
): ReactNode {
	switch (segment.type) {
		case 'markdown':
			return (
				<Streamdown mode='static' plugins={markdownPlugins} components={markdownComponents}>
					{segment.content}
				</Streamdown>
			);
		case 'chart':
			return (
				<EditorStoryChartEditProvider onReplaceTag={onReplaceTag}>
					<StoryChartEmbed
						chart={segment.chart}
						dragHandle={dragHandle}
						dragHandlePlacement={dragHandlePlacement}
						isSelected={isSelected}
					/>
				</EditorStoryChartEditProvider>
			);
		case 'table':
			return (
				<StoryTableEmbed
					table={segment.table}
					dragHandle={dragHandle}
					dragHandlePlacement={dragHandlePlacement}
				/>
			);
		case 'map':
			return (
				<EditorStoryMapEditProvider onReplaceTag={onReplaceTag}>
					<StoryMapEmbed map={segment.map} dragHandle={dragHandle} />
				</EditorStoryMapEditProvider>
			);
		case 'grid':
			return (
				<div className='flex flex-col gap-4'>
					{segment.children.map((child, index) => (
						<div key={index} className='min-w-0'>
							{renderColumnContent(child, null, onReplaceTag, 'trailing', false)}
						</div>
					))}
				</div>
			);
	}
}

function GridBlockView(props: ReactNodeViewProps) {
	const selectedGridColumns = useContext(BlockSelectionContext);
	const storyBlockDrag = useContext(StoryBlockDragContext);
	const {
		gridRef,
		segments,
		cols,
		visualWidths,
		activeBoundary,
		resizeHandlePositions,
		dropIndicatorLeft,
		externalBlockActive,
		handleReplaceTag,
		clearDrag,
		handleColumnDragStart,
		handleGridDragOver,
		handleGridDrop,
		insertExternalStoryBlock,
		handleResizeStart,
		updateResize,
		finishResize,
		handleResizeKeyDown,
		setBlockDropIndex,
	} = useStoryEditorGridBlock(props);
	const resolvedGridPos = props.getPos();
	const gridPos = typeof resolvedGridPos === 'number' ? resolvedGridPos : null;

	return (
		<NodeViewWrapper draggable data-type='grid-block'>
			<div
				className='@container relative my-2'
				onDragOver={handleGridDragOver}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
						setBlockDropIndex(null);
					}
				}}
				onDrop={handleGridDrop}
			>
				<div
					ref={gridRef}
					className={
						visualWidths !== null
							? 'grid grid-cols-1 gap-4 @lg:[grid-template-columns:var(--nao-grid-cols)]'
							: `grid ${getGridClass(cols)} gap-4`
					}
					{...(visualWidths !== null
						? { style: { ['--nao-grid-cols' as string]: getGridTemplateColumns(visualWidths) } }
						: {})}
				>
					{segments.map((segment, i) => {
						// Markdown columns cannot be dragged out (createBlockNode would
						// turn their markdown into literal text), so only chart/table
						// columns get a move handle.
						const columnGrip =
							segments.length >= 2 && (segment.type === 'chart' || segment.type === 'table') ? (
								<button
									type='button'
									aria-label={`Move column ${i + 1}`}
									data-block-drag-grip=''
									contentEditable={false}
									draggable
									className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
									onClick={(event) => {
										event.stopPropagation();
										if (gridPos === null) {
											return;
										}
										const next = selectColumnFromHandle(props.editor.state, gridPos, i);
										if (!next) {
											return;
										}
										props.editor.view.dispatch(
											props.editor.state.tr.setMeta(blockSelectionPluginKey, next),
										);
									}}
									onPointerDown={(event) => {
										event.stopPropagation();
									}}
									onDragStart={(event) => {
										handleColumnDragStart(i, event);
									}}
									onDragEnd={(event) => {
										event.stopPropagation();
										clearDrag();
									}}
								>
									<GripVertical className='size-3.5' />
								</button>
							) : null;
						const isLeftmostColumn = i === 0;
						const canDragColumn = columnGrip !== null;
						const isColumnSelected =
							gridPos !== null &&
							selectedGridColumns.some((column) => column.gridPos === gridPos && column.index === i);

						return (
							<div
								key={i}
								className={cn(
									'group relative min-w-0',
									gridPos !== null &&
										selectedGridColumns.some(
											(column) => column.gridPos === gridPos && column.index === i,
										) &&
										'nao-block-selected',
								)}
								draggable={canDragColumn || undefined}
								onDragStart={canDragColumn ? (event) => handleColumnDragStart(i, event) : undefined}
								onDragEnd={
									canDragColumn
										? (event) => {
												event.stopPropagation();
												clearDrag();
											}
										: undefined
								}
								{...(gridPos === null
									? {}
									: {
											'data-grid-column': '',
											'data-col-index': i,
											'data-grid-pos': gridPos,
											'data-col-type': segment.type,
										})}
							>
								{isLeftmostColumn && columnGrip ? (
									<div contentEditable={false} className='absolute -left-10 top-2 z-20'>
										{columnGrip}
									</div>
								) : null}
								{renderColumnContent(
									segment,
									isLeftmostColumn ? null : columnGrip,
									handleReplaceTag,
									'leading',
									isColumnSelected,
								)}
							</div>
						);
					})}
				</div>
				{externalBlockActive && (
					<>
						<div
							contentEditable={false}
							className='absolute inset-y-0 -left-3 z-40 w-8'
							onDragOver={(event) => {
								event.preventDefault();
								event.stopPropagation();
								event.dataTransfer.dropEffect = 'move';
								setBlockDropIndex(0);
								if (gridPos !== null) {
									storyBlockDrag?.setActiveDropZone((current) => {
										const id = `grid:${gridPos}`;
										return current === id ? current : id;
									});
								}
								if (storyBlockDrag) {
									storyBlockDrag.pendingDropRef.current = () => handleGridDrop();
								}
							}}
							onDrop={(event) => {
								event.preventDefault();
								event.stopPropagation();
								insertExternalStoryBlock(0);
							}}
						/>
						<div
							contentEditable={false}
							className='absolute inset-y-0 -right-3 z-40 w-8'
							onDragOver={(event) => {
								event.preventDefault();
								event.stopPropagation();
								event.dataTransfer.dropEffect = 'move';
								setBlockDropIndex(segments.length);
								if (gridPos !== null) {
									storyBlockDrag?.setActiveDropZone((current) => {
										const id = `grid:${gridPos}`;
										return current === id ? current : id;
									});
								}
								if (storyBlockDrag) {
									storyBlockDrag.pendingDropRef.current = () => handleGridDrop();
								}
							}}
							onDrop={(event) => {
								event.preventDefault();
								event.stopPropagation();
								insertExternalStoryBlock(segments.length);
							}}
						/>
					</>
				)}
				{dropIndicatorLeft !== null &&
					gridPos !== null &&
					storyBlockDrag?.activeDropZone === `grid:${gridPos}` && (
						<div
							contentEditable={false}
							className='pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-primary-muted'
							style={{ left: dropIndicatorLeft }}
						/>
					)}
				{resizeHandlePositions.map(({ index, left }) => (
					<button
						key={index}
						type='button'
						aria-label={`Resize columns ${index + 1} and ${index + 2}`}
						contentEditable={false}
						className='group absolute inset-y-0 z-10 hidden w-4 -translate-x-1/2 cursor-col-resize touch-none select-none @lg:block'
						draggable={false}
						style={{ left }}
						onKeyDown={(event) => {
							handleResizeKeyDown(index, event);
						}}
						onPointerDown={(event) => {
							handleResizeStart(index, event);
						}}
						onPointerMove={(event) => {
							if (event.currentTarget.hasPointerCapture(event.pointerId)) {
								updateResize(event.clientX);
							}
						}}
						onPointerUp={(event) => {
							finishResize(event, true);
						}}
						onPointerCancel={(event) => {
							finishResize(event, false);
						}}
					>
						<div
							className={`mx-auto h-full w-0.5 transition-colors ${
								activeBoundary === index
									? 'bg-primary'
									: 'bg-border/50 group-hover:bg-primary group-focus-visible:bg-primary'
							}`}
						/>
					</button>
				))}
			</div>
		</NodeViewWrapper>
	);
}

export const GridBlock = Node.create({
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
