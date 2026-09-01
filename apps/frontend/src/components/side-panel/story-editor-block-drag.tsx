import { groupBlocksIntoGrid } from '@nao/shared/story-segments';
import { CornerUpRight, GripVertical, Trash2 } from 'lucide-react';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
	blockSelectionPluginKey,
	deleteSelectedBlocks,
	emptySelection,
	resolveDragSelection,
	selectBlockFromHandle,
	selectColumnFromHandle,
} from './story-block-selection';
import { createBlockNode, removeCardFromOrigin } from './story-editor-utils';
import { GridDragContext, STORY_BLOCK_DRAG_TYPE, StoryBlockDragContext } from './story-editor-drag-context';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { DragOrigin } from './story-block-selection';
import type { StoryBlockDropSide } from './story-editor-drag-context';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStoryEditorSelectionActions } from '@/contexts/story-editor-selection-actions';
import { cn } from '@/lib/utils';

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
	const getOrigin = useCallback((): DragOrigin | null => {
		const pos = getPos();
		if (typeof pos !== 'number') {
			return null;
		}
		return { kind: 'block', pos };
	}, [getPos]);

	return (
		<StoryBlockActionGrip
			editor={editor}
			getOrigin={getOrigin}
			ariaLabel='Move story block'
			draggable
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		/>
	);
}

export function StoryBlockActionGrip({
	editor,
	getOrigin,
	ariaLabel,
	draggable,
	onDragStart,
	onDragEnd,
	iconClassName = 'size-3.5',
	lockHandleWhileOpen = false,
	wrapperClassName,
}: {
	editor: ReactNodeViewProps['editor'];
	getOrigin: () => DragOrigin | null;
	ariaLabel: string;
	draggable?: boolean;
	onDragStart?: (event: ReactDragEvent<HTMLElement>) => void;
	onDragEnd?: (event: ReactDragEvent<HTMLElement>) => void;
	iconClassName?: string;
	lockHandleWhileOpen?: boolean;
	wrapperClassName?: string;
}) {
	const selectionActions = useStoryEditorSelectionActions();
	const [open, setOpen] = useState(false);
	const gripRef = useRef<HTMLButtonElement>(null);
	const interactedOutsideRef = useRef(false);
	const selectOrigin = useCallback(() => {
		const origin = getOrigin();
		if (!origin) {
			return null;
		}
		const next =
			origin.kind === 'block'
				? selectBlockFromHandle(editor.state, origin.pos)
				: selectColumnFromHandle(editor.state, origin.gridPos, origin.index);
		if (next) {
			editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, next));
		}
		return origin;
	}, [editor, getOrigin]);
	const openMenu = useCallback(() => {
		if (selectOrigin()) {
			setOpen(true);
		}
	}, [selectOrigin]);
	const deleteSelection = useCallback(() => {
		const origin = getOrigin();
		if (!origin) {
			return;
		}
		deleteSelectedBlocks(editor.view, origin);
		editor.view.focus();
	}, [editor, getOrigin]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const closeForDrag = () => {
			setOpen(false);
		};
		document.addEventListener('dragstart', closeForDrag, true);
		return () => document.removeEventListener('dragstart', closeForDrag, true);
	}, [open]);

	useEffect(() => {
		if (!lockHandleWhileOpen || !open) {
			return;
		}
		editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', true));
		return () => {
			if (!editor.isDestroyed) {
				editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', false));
			}
		};
	}, [editor, lockHandleWhileOpen, open]);

	return (
		<DropdownMenu
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					setOpen(false);
				}
			}}
			modal={false}
		>
			<span className={cn('relative inline-flex', wrapperClassName)}>
				<DropdownMenuTrigger
					aria-hidden
					disabled
					tabIndex={-1}
					className='pointer-events-none absolute inset-0 opacity-0'
				/>
				<button
					ref={gripRef}
					type='button'
					aria-label={ariaLabel}
					aria-haspopup='menu'
					aria-expanded={open}
					data-block-drag-grip=''
					contentEditable={false}
					className='cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
					draggable={draggable}
					onClick={(event) => {
						event.stopPropagation();
						openMenu();
					}}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onMouseDown={(event) => {
						event.stopPropagation();
					}}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === 'ArrowDown') {
							event.preventDefault();
							openMenu();
						}
					}}
					onDragStart={(event) => {
						setOpen(false);
						onDragStart?.(event);
					}}
					onDragEnd={onDragEnd}
				>
					<GripVertical className={iconClassName} />
				</button>
			</span>
			<DropdownMenuContent
				data-story-block-action-menu=''
				align='start'
				aria-label={`${ariaLabel} actions`}
				aria-labelledby={undefined}
				onInteractOutside={() => {
					interactedOutsideRef.current = true;
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (!interactedOutsideRef.current) {
						gripRef.current?.focus();
					}
					interactedOutsideRef.current = false;
				}}
			>
				{selectionActions && selectionActions.destinations.length > 0 && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<CornerUpRight />
							<span>Move to a tab</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent data-story-block-action-menu=''>
							{selectionActions.destinations.map((destination) => (
								<DropdownMenuItem
									key={destination.index}
									onSelect={() => {
										const origin = getOrigin();
										if (origin) {
											selectionActions.moveSelection(origin, destination.index);
										}
									}}
								>
									{destination.title || 'Untitled'}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}
				<DropdownMenuItem variant='destructive' onSelect={deleteSelection}>
					<Trash2 />
					<span>Delete</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
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
