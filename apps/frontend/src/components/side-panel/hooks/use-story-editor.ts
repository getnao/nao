import { popGridColumn, popGridColumns } from '@nao/shared/story-segments';
import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import { useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	blockSelectionPluginKey,
	buildBlockMoveTransaction,
	emptySelection,
	getSelectedGridColumns,
	resolveDragBlocks,
	selectBlockFromHandle,
} from '../story-block-selection';
import { EDITOR_EXTENSIONS } from '../story-editor-extensions';
import { GRID_COLUMN_DRAG_TYPE, STORY_BLOCK_DRAG_TYPE } from '../story-editor-drag-context';
import {
	cloneElementWithStyles,
	createBlockNode,
	dispatchDropWithScroll,
	preprocessForEditor,
	removeCardFromOrigin,
} from '../story-editor-utils';
import type { GridDragSource, StoryBlockDragSource } from '../story-editor-drag-context';
import type { GridColumnRef } from '../story-block-selection';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import type { MutableRefObject } from 'react';

interface UseStoryEditorParams {
	code: string;
	editorRef: MutableRefObject<Editor | null>;
	onSave?: () => void;
}

/**
 * Builds the Tiptap editor instance for the story editor, wiring up the custom
 * block extensions, the save shortcut, and the drag-and-drop handlers that move
 * story blocks and grid columns around the document.
 */
export function useStoryEditor({ code, editorRef, onSave }: UseStoryEditorParams) {
	const processedContent = useMemo(() => preprocessForEditor(code), [code]);
	const onSaveRef = useRef(onSave);
	const gridDragSourceRef = useRef<GridDragSource | null>(null);
	const storyBlockSourceRef = useRef<StoryBlockDragSource | null>(null);
	const multiBlockDragRef = useRef<number[] | null>(null);
	const multiColumnDragRef = useRef<{ gridPos: number; indices: number[] } | null>(null);
	const handleNodePosRef = useRef<number | null>(null);
	const dragPreviewPositionsRef = useRef<number[] | null>(null);
	const storyEditorRef = useRef<HTMLDivElement>(null);
	const [isBlockDragging, setIsBlockDragging] = useState(false);
	const [handleNodeType, setHandleNodeType] = useState<string | null>(null);
	const [selectedGridColumns, setSelectedGridColumns] = useState<GridColumnRef[]>([]);
	const resetDragContexts = useCallback(() => {
		gridDragSourceRef.current = null;
		storyBlockSourceRef.current = null;
		multiBlockDragRef.current = null;
		multiColumnDragRef.current = null;
		dragPreviewPositionsRef.current = null;
		setIsBlockDragging(false);
	}, []);
	const handleDragHandleNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
		setHandleNodeType(node?.type.name ?? null);
		handleNodePosRef.current = node ? pos : null;
	}, []);
	onSaveRef.current = onSave;

	const extensions = useMemo(
		() => [
			...EDITOR_EXTENSIONS,
			Extension.create({
				name: 'saveShortcut',
				addKeyboardShortcuts() {
					return {
						'Mod-s': () => {
							onSaveRef.current?.();
							return true;
						},
					};
				},
			}),
		],
		[],
	);

	const editor = useEditor({
		extensions,
		content: processedContent,
		contentType: 'markdown',
		editorProps: {
			handleDOMEvents: {
				dragover(_view, event) {
					if (
						event.dataTransfer?.types.includes(GRID_COLUMN_DRAG_TYPE) ||
						event.dataTransfer?.types.includes(STORY_BLOCK_DRAG_TYPE)
					) {
						event.preventDefault();
					}
					return false;
				},
			},
			handleDrop(view, event) {
				const dataTransfer = event.dataTransfer;
				if (multiColumnDragRef.current) {
					try {
						const { gridPos, indices } = multiColumnDragRef.current;
						const { state } = view;
						const gridNode = state.doc.nodeAt(gridPos);
						if (!gridNode || gridNode.type.name !== 'gridBlock') {
							return true;
						}
						const result = popGridColumns(gridNode.attrs.rawContent as string, indices);
						if (!result) {
							return true;
						}
						const droppedNode = createBlockNode(state.schema, result.popped);
						if (!droppedNode) {
							return true;
						}
						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}
						const gridFrom = gridPos;
						const gridTo = gridPos + gridNode.nodeSize;
						const slice = new Slice(Fragment.from(droppedNode), 0, 0);
						const dropTarget = dropPoint(state.doc, coords.pos, slice);
						if (dropTarget === null) {
							return true;
						}
						let insertPos = dropTarget;
						if (insertPos > gridFrom && insertPos < gridTo) {
							insertPos = gridTo;
						}
						const transaction = state.tr;
						if (result.remaining === null) {
							transaction.delete(gridFrom, gridTo);
						} else {
							const remainingNode = createBlockNode(state.schema, result.remaining);
							if (!remainingNode) {
								return true;
							}
							transaction.replaceWith(gridFrom, gridTo, remainingNode);
						}
						const insertAssoc = insertPos >= gridTo ? 1 : -1;
						transaction.insert(transaction.mapping.map(insertPos, insertAssoc), droppedNode);
						transaction.setMeta(blockSelectionPluginKey, emptySelection());
						view.dispatch(transaction);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				if (multiBlockDragRef.current && multiBlockDragRef.current.length > 1) {
					try {
						const positions = multiBlockDragRef.current;
						const { state } = view;
						const nodes = positions
							.map((position) => state.doc.nodeAt(position))
							.filter((node): node is PMNode => node != null);
						if (nodes.length === 0) {
							return true;
						}
						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}
						const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
						const insertPos = dropPoint(state.doc, coords.pos, slice) ?? coords.pos;
						const move = buildBlockMoveTransaction(state, positions, insertPos);
						if (!move) {
							return true;
						}
						dispatchDropWithScroll(view, move.transaction, move.insertPos);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				if (dataTransfer?.types.includes(GRID_COLUMN_DRAG_TYPE)) {
					try {
						const source = gridDragSourceRef.current;
						if (!source) {
							return true;
						}

						const { state } = view;
						const gridNode = state.doc.nodeAt(source.gridPos);
						if (!gridNode || gridNode.type.name !== 'gridBlock') {
							return true;
						}

						const result = popGridColumn(gridNode.attrs.rawContent as string, source.columnIndex);
						if (!result) {
							return true;
						}

						const poppedNode = createBlockNode(state.schema, result.popped);
						const remainingNode = createBlockNode(state.schema, result.remaining);
						if (!poppedNode || !remainingNode) {
							return true;
						}

						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}

						const gridFrom = source.gridPos;
						const gridTo = source.gridPos + gridNode.nodeSize;
						const slice = new Slice(Fragment.from(poppedNode), 0, 0);
						const dropTarget = dropPoint(state.doc, coords.pos, slice);
						if (dropTarget === null) {
							return true;
						}
						let insertPos = dropTarget;
						if (insertPos > gridFrom && insertPos < gridTo) {
							insertPos = gridTo;
						}

						const transaction = state.tr;
						transaction.replaceWith(gridFrom, gridTo, remainingNode);
						// Bias mapping to the right for drops at/after the grid so the popped
						// column lands after the remaining grid, left otherwise.
						const insertAssoc = insertPos >= gridTo ? 1 : -1;
						transaction.insert(transaction.mapping.map(insertPos, insertAssoc), poppedNode);
						view.dispatch(transaction);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				if (dataTransfer?.types.includes(STORY_BLOCK_DRAG_TYPE)) {
					try {
						const source = storyBlockSourceRef.current;
						if (!source) {
							return true;
						}

						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}

						const node = createBlockNode(view.state.schema, source.markup);
						if (!node) {
							return true;
						}

						const slice = new Slice(Fragment.from(node), 0, 0);
						const insertPos = dropPoint(view.state.doc, coords.pos, slice);
						if (insertPos === null) {
							return true;
						}
						if (source.origin.kind === 'block') {
							const originNode = view.state.doc.nodeAt(source.origin.pos);
							const originTo = originNode ? source.origin.pos + originNode.nodeSize : source.origin.pos;
							if (insertPos >= source.origin.pos && insertPos <= originTo) {
								return true;
							}
						}

						const transaction = view.state.tr;
						transaction.insert(insertPos, node);
						removeCardFromOrigin(transaction, view.state, source.origin);
						view.dispatch(transaction);
						event.preventDefault();
						return true;
					} finally {
						resetDragContexts();
					}
				}

				return false;
			},
		},
	});

	useEffect(() => {
		const container = storyEditorRef.current;
		if (!container || !editor) {
			return;
		}

		const onDragStart = (event: DragEvent) => {
			const positions = dragPreviewPositionsRef.current;
			if (!positions || positions.length === 0) {
				return;
			}
			setDragPreviewImage(editor, positions, event);
		};

		const clearDropCursor = () => {
			dragPreviewPositionsRef.current = null;
			editor.view.dom.dispatchEvent(new DragEvent('dragleave'));
		};

		const resetBlockDragState = () => {
			setIsBlockDragging(false);
			storyBlockSourceRef.current = null;
			multiBlockDragRef.current = null;
			multiColumnDragRef.current = null;
			dragPreviewPositionsRef.current = null;
		};

		container.addEventListener('dragstart', onDragStart);
		document.addEventListener('dragend', clearDropCursor, true);
		document.addEventListener('drop', clearDropCursor, true);
		document.addEventListener('dragend', resetBlockDragState);
		return () => {
			container.removeEventListener('dragstart', onDragStart);
			document.removeEventListener('dragend', clearDropCursor, true);
			document.removeEventListener('drop', clearDropCursor, true);
			document.removeEventListener('dragend', resetBlockDragState);
		};
	}, [editor]);

	useEffect(() => {
		if (!editor) {
			setSelectedGridColumns([]);
			return;
		}

		const syncGridColumns = () => {
			const next = getSelectedGridColumns(editor.state);
			setSelectedGridColumns((current) => (sameGridColumns(current, next) ? current : next));
		};
		syncGridColumns();
		editor.on('transaction', syncGridColumns);
		return () => {
			editor.off('transaction', syncGridColumns);
		};
	}, [editor]);

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
		if (editor.getMarkdown() === code) {
			return;
		}
		editor.commands.setContent(processedContent, { emitUpdate: false, contentType: 'markdown' });
	}, [editor, code, processedContent]);

	const onElementDragStart = useCallback(
		(event: DragEvent) => {
			if (!editor) {
				return;
			}
			const hoveredPosition = handleNodePosRef.current;
			const hoveredNode = hoveredPosition == null ? null : editor.state.doc.nodeAt(hoveredPosition);
			if (
				hoveredNode != null &&
				(hoveredNode.type.name === 'gridBlock' ||
					hoveredNode.type.name === 'chartBlock' ||
					hoveredNode.type.name === 'tableBlock')
			) {
				event.preventDefault();
				return;
			}
			const selection = blockSelectionPluginKey.getState(editor.state);
			const dragBlocks = hoveredPosition == null ? null : resolveDragBlocks(editor.state, hoveredPosition);
			if (dragBlocks?.isMulti) {
				multiBlockDragRef.current = dragBlocks.positions;
				dragPreviewPositionsRef.current = dragBlocks.positions;
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
				}
			} else {
				multiBlockDragRef.current = null;
				dragPreviewPositionsRef.current = dragBlocks?.positions ?? null;
				if (selection?.blocks.length || selection?.gridColumns.length) {
					editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
				}
			}
		},
		[editor],
	);
	const endMultiBlockDrag = useCallback(() => {
		multiBlockDragRef.current = null;
		dragPreviewPositionsRef.current = null;
	}, []);
	const beginMultiBlockDrag = useCallback(
		(positions: number[], event: DragEvent) => {
			multiBlockDragRef.current = positions;
			dragPreviewPositionsRef.current = positions;
			if (!editor || !event.dataTransfer) {
				return;
			}
			event.dataTransfer.effectAllowed = 'move';
			setDragPreviewImage(editor, positions, event);
		},
		[editor],
	);
	const beginMultiColumnDrag = useCallback((gridPos: number, indices: number[], event: DragEvent) => {
		multiColumnDragRef.current = { gridPos, indices };
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(STORY_BLOCK_DRAG_TYPE, '1');
		}
	}, []);
	const storyBlockDragContext = useMemo(
		() => ({
			sourceRef: storyBlockSourceRef,
			isDragging: isBlockDragging,
			setDragging: setIsBlockDragging,
			beginMultiBlockDrag,
			beginMultiColumnDrag,
			endMultiBlockDrag,
		}),
		[beginMultiBlockDrag, beginMultiColumnDrag, endMultiBlockDrag, isBlockDragging],
	);
	const onElementDragEnd = endMultiBlockDrag;
	const onDragHandleClick = useCallback(() => {
		if (!editor) {
			return;
		}
		const pos = handleNodePosRef.current;
		if (pos == null) {
			return;
		}
		const node = editor.state.doc.nodeAt(pos);
		if (
			node != null &&
			(node.type.name === 'gridBlock' || node.type.name === 'chartBlock' || node.type.name === 'tableBlock')
		) {
			return;
		}
		const next = selectBlockFromHandle(editor.state, pos);
		if (!next) {
			return;
		}
		editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, next));
	}, [editor]);

	return {
		editor,
		gridDragSourceRef,
		storyBlockDragContext,
		selectedGridColumns,
		handleDragHandleNodeChange,
		handleNodeType,
		storyEditorRef,
		onElementDragStart,
		onElementDragEnd,
		onDragHandleClick,
	};
}

function sameGridColumns(first: GridColumnRef[], second: GridColumnRef[]): boolean {
	return (
		first.length === second.length &&
		first.every((column, index) => column.gridPos === second[index].gridPos && column.index === second[index].index)
	);
}

function setDragPreviewImage(editor: Editor, positions: number[], event: DragEvent): void {
	if (!event.dataTransfer) {
		return;
	}

	const nodes = positions
		.map((position) => editor.view.nodeDOM(position))
		.filter((dom): dom is HTMLElement => dom instanceof HTMLElement);
	if (nodes.length === 0) {
		return;
	}

	const preview = document.createElement('div');
	preview.style.position = 'absolute';
	preview.style.top = '-10000px';
	preview.style.left = '-10000px';

	for (const dom of nodes) {
		preview.appendChild(cloneElementWithStyles(dom));
	}

	document.body.appendChild(preview);
	event.dataTransfer.setDragImage(preview, 16, 16);

	const cleanup = () => {
		preview.remove();
		document.removeEventListener('dragend', cleanup);
		document.removeEventListener('drop', cleanup);
	};
	document.addEventListener('dragend', cleanup);
	document.addEventListener('drop', cleanup);
}
