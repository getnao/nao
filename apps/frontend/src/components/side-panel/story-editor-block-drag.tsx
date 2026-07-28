import { groupBlocksIntoGrid } from '@nao/shared/story-segments';
import { GripVertical } from 'lucide-react';
import { useCallback, useContext } from 'react';
import {
	blockSelectionPluginKey,
	emptySelection,
	resolveDragSelection,
	selectBlockFromHandle,
} from './story-block-selection';
import { createBlockNode, removeCardFromOrigin } from './story-editor-utils';
import { GridDragContext, STORY_BLOCK_DRAG_TYPE, StoryBlockDragContext } from './story-editor-drag-context';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { StoryBlockDropSide } from './story-editor-drag-context';

export function useStoryBlockDrag({ node, editor, getPos }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'>) {
	const dragContext = useContext(StoryBlockDragContext);

	const handleDragStart = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			event.stopPropagation();
			const pos = getPos();
			if (typeof pos !== 'number' || !dragContext) {
				return;
			}
			event.dataTransfer.setData(STORY_BLOCK_DRAG_TYPE, '1');
			const units = resolveDragSelection(editor.state, { kind: 'block', pos });
			if (units) {
				dragContext.beginMultiSelectionDrag(units, event.nativeEvent);
				return;
			}

			const selection = blockSelectionPluginKey.getState(editor.state);
			if (selection?.blocks.length || selection?.gridColumns.length) {
				editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
			}

			event.dataTransfer.effectAllowed = 'move';
			dragContext.sourceRef.current = {
				markup: node.attrs.rawTag as string,
				origin: { kind: 'block', pos },
			};
			dragContext.setDragging(true);
		},
		[dragContext, editor, getPos, node.attrs.rawTag],
	);

	const handleDragEnd = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			event.stopPropagation();
			if (dragContext) {
				dragContext.setDragging(false);
				dragContext.sourceRef.current = null;
				dragContext.endMultiSelectionDrag();
			}
		},
		[dragContext],
	);

	return { handleDragStart, handleDragEnd };
}

export function StoryBlockDragGrip({ node, editor, getPos }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'>) {
	const { handleDragStart, handleDragEnd } = useStoryBlockDrag({ node, editor, getPos });

	return (
		<button
			type='button'
			aria-label='Move story block'
			data-block-drag-grip=''
			contentEditable={false}
			className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
			draggable
			onClick={(event) => {
				event.stopPropagation();
				const pos = getPos();
				if (typeof pos !== 'number') {
					return;
				}
				const next = selectBlockFromHandle(editor.state, pos);
				if (!next) {
					return;
				}
				editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, next));
			}}
			onPointerDown={(event) => {
				event.stopPropagation();
			}}
			onMouseDown={(event) => {
				event.stopPropagation();
			}}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<GripVertical className='size-3.5' />
		</button>
	);
}

export function StoryBlockDropZones({ node, editor, getPos }: Pick<ReactNodeViewProps, 'node' | 'editor' | 'getPos'>) {
	const dragContext = useContext(StoryBlockDragContext);
	const gridDragSourceRef = useContext(GridDragContext);
	const currentPos = getPos();
	const sourceOrigin = dragContext?.sourceRef.current?.origin;
	const isDropTarget =
		typeof currentPos === 'number' &&
		dragContext?.isDragging === true &&
		dragContext.sourceRef.current !== null &&
		!(sourceOrigin?.kind === 'block' && sourceOrigin.pos === currentPos);

	const resetDrag = useCallback(() => {
		if (dragContext) {
			dragContext.setDragging(false);
			dragContext.sourceRef.current = null;
		}
		if (gridDragSourceRef) {
			gridDragSourceRef.current = null;
		}
	}, [dragContext, gridDragSourceRef]);

	const handleDrop = useCallback(
		(side: StoryBlockDropSide, event?: ReactDragEvent<HTMLDivElement>) => {
			event?.preventDefault();
			event?.stopPropagation();
			const source = dragContext?.sourceRef.current;
			const targetPos = getPos();
			if (
				!source ||
				typeof targetPos !== 'number' ||
				(source.origin.kind === 'block' && source.origin.pos === targetPos)
			) {
				resetDrag();
				return;
			}

			const state = editor.state;
			const targetMarkup = node.attrs.rawTag as string;
			const leftMarkup = side === 'left' ? source.markup : targetMarkup;
			const rightMarkup = side === 'left' ? targetMarkup : source.markup;
			const gridNode = createBlockNode(state.schema, groupBlocksIntoGrid(leftMarkup, rightMarkup));
			if (!gridNode) {
				resetDrag();
				return;
			}

			const transaction = state.tr;
			transaction.replaceWith(targetPos, targetPos + node.nodeSize, gridNode);
			removeCardFromOrigin(transaction, state, source.origin);
			editor.view.dispatch(transaction);
			resetDrag();
		},
		[dragContext, editor, getPos, node, resetDrag],
	);

	return (
		isDropTarget &&
		(['left', 'right'] as const).map((side) => {
			const zoneId = `block:${currentPos}:${side}`;
			return (
				<div
					key={side}
					contentEditable={false}
					className={`absolute inset-y-0 z-30 w-1/2 ${side === 'left' ? 'left-0' : 'right-0'}`}
					onDragOver={(event) => {
						event.preventDefault();
						event.stopPropagation();
						event.dataTransfer.dropEffect = 'move';
						dragContext?.setActiveDropZone((current) => (current === zoneId ? current : zoneId));
						if (dragContext) {
							dragContext.pendingDropRef.current = () => handleDrop(side);
						}
					}}
					onDrop={(event) => {
						handleDrop(side, event);
					}}
				>
					{dragContext?.activeDropZone === zoneId && (
						<div
							className={`pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-primary-muted ${
								side === 'left' ? 'left-0' : 'right-0'
							}`}
						/>
					)}
				</div>
			);
		})
	);
}
