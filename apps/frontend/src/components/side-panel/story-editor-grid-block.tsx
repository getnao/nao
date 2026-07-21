import { getGridClass, getGridTemplateColumns } from '@nao/shared/story-segments';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { GripVertical } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryTableEmbed } from './story-table-embed';
import { decodeFromAttr } from './story-editor-utils';
import { useStoryEditorGridBlock } from './hooks/use-story-editor-grid-block';
import type { ReactNodeViewProps } from '@tiptap/react';
import { EditorStoryChartEditProvider } from '@/contexts/story-chart-edit';

function GridBlockView(props: ReactNodeViewProps) {
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
						const columnGrip =
							segments.length >= 2 ? (
								<button
									type='button'
									aria-label={`Move column ${i + 1}`}
									contentEditable={false}
									draggable
									className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
									onClick={(event) => {
										event.stopPropagation();
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

						return (
							<div key={i} className='group relative min-w-0'>
								{segment.type === 'markdown' ? (
									<>
										{columnGrip !== null && (
											<div className='absolute right-1 top-1 z-20 opacity-0 transition-opacity group-hover:opacity-100'>
												{columnGrip}
											</div>
										)}
										<Streamdown mode='static'>{segment.content}</Streamdown>
									</>
								) : segment.type === 'chart' ? (
									<EditorStoryChartEditProvider onReplaceTag={handleReplaceTag}>
										<StoryChartEmbed chart={segment.chart} dragHandle={columnGrip} />
									</EditorStoryChartEditProvider>
								) : segment.type === 'table' ? (
									<StoryTableEmbed table={segment.table} dragHandle={columnGrip} />
								) : null}
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
							}}
							onDrop={(event) => {
								event.preventDefault();
								event.stopPropagation();
								insertExternalStoryBlock(segments.length);
							}}
						/>
					</>
				)}
				{dropIndicatorLeft !== null && (
					<div
						contentEditable={false}
						className='pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-primary'
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
