import { popGridColumn } from '@nao/shared/story-segments';
import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import { useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	blockSelectionPluginKey,
	buildDragUnitNodes,
	buildSelectionMoveTransaction,
	emptySelection,
	getSelectedBlockPositions,
	getSelectedGridColumns,
	resolveDragSelection,
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
import { shouldSyncStoryEditorContent } from './story-editor-content-sync';
import type { GridDragSource, StoryBlockDragSource } from '../story-editor-drag-context';
import type { DragUnit, GridColumnRef } from '../story-block-selection';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import type { MutableRefObject } from 'react';

interface UseStoryEditorParams {
	code: string;
	editorRef: MutableRefObject<Editor | null>;
	onSave?: () => void;
	onChange?: (code: string) => void;
}

/**
 * Builds the Tiptap editor instance for the story editor, wiring up the custom
 * block extensions, the save shortcut, and the drag-and-drop handlers that move
 * story blocks and grid columns around the document.
 */
export function useStoryEditor({ code, editorRef, onSave, onChange }: UseStoryEditorParams) {
	const processedContent = useMemo(() => preprocessForEditor(code), [code]);
	const onSaveRef = useRef(onSave);
	const onChangeRef = useRef(onChange);
	const lastEmittedMarkdownRef = useRef<string | null>(null);
	const gridDragSourceRef = useRef<GridDragSource | null>(null);
	const storyBlockSourceRef = useRef<StoryBlockDragSource | null>(null);
	const multiSelectionDragRef = useRef<DragUnit[] | null>(null);
	const handleNodePosRef = useRef<number | null>(null);
	const dragPreviewElementsRef = useRef<HTMLElement[] | null>(null);
	const pendingDropRef = useRef<(() => void) | null>(null);
	const storyEditorRef = useRef<HTMLDivElement>(null);
	const [isBlockDragging, setIsBlockDragging] = useState(false);
	const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
	const [handleNodeType, setHandleNodeType] = useState<string | null>(null);
	const [selectedGridColumns, setSelectedGridColumns] = useState<GridColumnRef[]>([]);
	const [selectedBlocks, setSelectedBlocks] = useState<number[]>([]);
	const resetDragContexts = useCallback(() => {
		gridDragSourceRef.current = null;
		storyBlockSourceRef.current = null;
		multiSelectionDragRef.current = null;
		dragPreviewElementsRef.current = null;
		pendingDropRef.current = null;
		setIsBlockDragging(false);
		setActiveDropZone((current) => (current === null ? current : null));
	}, []);
	const buildStoryDragSlice = useCallback((state: EditorState): Slice | null => {
		const units = multiSelectionDragRef.current;
		if (units) {
			const nodes = buildDragUnitNodes(state, units);
			if (nodes?.length) {
				return new Slice(Fragment.fromArray(nodes), 0, 0);
			}
		}

		const source = storyBlockSourceRef.current;
		if (source) {
			const node = createBlockNode(state.schema, source.markup);
			if (node) {
				return new Slice(Fragment.from(node), 0, 0);
			}
		}

		return null;
	}, []);
	const handleDragHandleNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
		setHandleNodeType(node?.type.name ?? null);
		handleNodePosRef.current = node ? pos : null;
	}, []);
	onSaveRef.current = onSave;
	onChangeRef.current = onChange;

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
				dragover(view, event) {
					if (
						event.dataTransfer?.types.includes(GRID_COLUMN_DRAG_TYPE) ||
						event.dataTransfer?.types.includes(STORY_BLOCK_DRAG_TYPE)
					) {
						event.preventDefault();
						setActiveDropZone((current) => (current === null ? current : null));
						pendingDropRef.current = null;
						if (!view.dragging) {
							const slice = buildStoryDragSlice(view.state);
							if (slice) {
								view.dragging = { slice, move: true };
							}
						}
					}
					return false;
				},
			},
			handleDrop(view, event) {
				const dataTransfer = event.dataTransfer;
				if (multiSelectionDragRef.current) {
					try {
						const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
						if (!coords) {
							return true;
						}
						const move = buildSelectionMoveTransaction(
							view.state,
							multiSelectionDragRef.current,
							coords.pos,
						);
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

		const normalizeBlockDropCursor = () => {
			const cursor = container.querySelector<HTMLElement>('.drop-cursor.prosemirror-dropcursor-block');
			const offsetParent = cursor?.offsetParent;
			if (!cursor || !(offsetParent instanceof HTMLElement)) {
				return;
			}

			const editorDom = editor.view.dom;
			const editorRect = editorDom.getBoundingClientRect();
			const editorStyle = getComputedStyle(editorDom);
			const parentRect = offsetParent.getBoundingClientRect();
			const parentScaleX = parentRect.width / offsetParent.offsetWidth || 1;
			const parentScaleY = parentRect.height / offsetParent.offsetHeight || 1;
			const parentLeft = parentRect.left - offsetParent.scrollLeft * parentScaleX;
			const paddingLeft = Number.parseFloat(editorStyle.paddingLeft) || 0;
			const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
			const desiredLeft = editorRect.left + paddingLeft;
			const desiredRight = editorRect.right - paddingRight;

			cursor.style.setProperty('left', `${(desiredLeft - parentLeft) / parentScaleX}px`, 'important');
			cursor.style.setProperty('right', 'auto', 'important');
			cursor.style.setProperty(
				'width',
				`${Math.max(0, desiredRight - desiredLeft) / parentScaleX}px`,
				'important',
			);
			cursor.style.setProperty('height', '2px', 'important');

			const cursorRect = cursor.getBoundingClientRect();
			const deviceScale = window.devicePixelRatio || 1;
			const snappedTop = Math.round(cursorRect.top * deviceScale) / deviceScale;
			const currentTop = Number.parseFloat(cursor.style.top);
			if (Number.isFinite(currentTop)) {
				cursor.style.setProperty(
					'top',
					`${currentTop + (snappedTop - cursorRect.top) / parentScaleY}px`,
					'important',
				);
			}
		};

		const onDragStart = (event: DragEvent) => {
			const elements = dragPreviewElementsRef.current;
			if (!elements || elements.length === 0) {
				return;
			}
			setDragPreviewImage(elements, event);
		};

		const onDragOver = () => {
			normalizeBlockDropCursor();
		};

		const clearDropCursor = () => {
			dragPreviewElementsRef.current = null;
			editor.view.dom.dispatchEvent(new DragEvent('dragleave'));
		};

		const resetBlockDragState = () => {
			setIsBlockDragging(false);
			setActiveDropZone((current) => (current === null ? current : null));
			pendingDropRef.current = null;
			storyBlockSourceRef.current = null;
			multiSelectionDragRef.current = null;
			dragPreviewElementsRef.current = null;
			editor.view.dragging = null;
		};

		const deferredResetBlockDragState = () => {
			requestAnimationFrame(resetBlockDragState);
		};

		const onDocumentDrop = (event: DragEvent) => {
			if (multiSelectionDragRef.current) {
				return;
			}
			const action = pendingDropRef.current;
			if (!action) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			action();
			pendingDropRef.current = null;
			setActiveDropZone(null);
		};

		container.addEventListener('dragstart', onDragStart);
		editor.view.dom.addEventListener('dragover', onDragOver);
		document.addEventListener('drop', onDocumentDrop, true);
		document.addEventListener('dragend', clearDropCursor, true);
		document.addEventListener('drop', clearDropCursor, true);
		document.addEventListener('dragend', resetBlockDragState, true);
		document.addEventListener('drop', deferredResetBlockDragState, true);
		return () => {
			container.removeEventListener('dragstart', onDragStart);
			editor.view.dom.removeEventListener('dragover', onDragOver);
			document.removeEventListener('drop', onDocumentDrop, true);
			document.removeEventListener('dragend', clearDropCursor, true);
			document.removeEventListener('drop', clearDropCursor, true);
			document.removeEventListener('dragend', resetBlockDragState, true);
			document.removeEventListener('drop', deferredResetBlockDragState, true);
		};
	}, [editor]);

	useEffect(() => {
		if (!editor) {
			setSelectedGridColumns([]);
			setSelectedBlocks([]);
			return;
		}

		const syncGridColumns = () => {
			const next = getSelectedGridColumns(editor.state);
			setSelectedGridColumns((current) => (sameGridColumns(current, next) ? current : next));
			const nextBlocks = getSelectedBlockPositions(editor.state);
			setSelectedBlocks((current) =>
				current.length === nextBlocks.length && current.every((value, index) => value === nextBlocks[index])
					? current
					: nextBlocks,
			);
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
		const handleUpdate = () => {
			const markdown = editor.getMarkdown();
			lastEmittedMarkdownRef.current = markdown;
			onChangeRef.current?.(markdown);
		};
		editor.on('update', handleUpdate);
		return () => {
			editor.off('update', handleUpdate);
		};
	}, [editor]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		if (
			!shouldSyncStoryEditorContent({
				editorMarkdown: editor.getMarkdown(),
				incomingCode: code,
				lastEmittedMarkdown: lastEmittedMarkdownRef.current,
			})
		) {
			lastEmittedMarkdownRef.current = null;
			return;
		}
		lastEmittedMarkdownRef.current = null;
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
			const units =
				hoveredPosition == null
					? null
					: resolveDragSelection(editor.state, { kind: 'block', pos: hoveredPosition });
			if (units) {
				multiSelectionDragRef.current = units;
				dragPreviewElementsRef.current = resolveDragPreviewElements(editor, units);
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
				}
			} else {
				multiSelectionDragRef.current = null;
				dragPreviewElementsRef.current =
					hoveredPosition == null
						? null
						: resolveDragPreviewElements(editor, [{ kind: 'block', pos: hoveredPosition }]);
				if (selection?.blocks.length || selection?.gridColumns.length) {
					editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
				}
			}
		},
		[editor],
	);
	const endMultiSelectionDrag = useCallback(() => {
		multiSelectionDragRef.current = null;
		dragPreviewElementsRef.current = null;
	}, []);
	const beginMultiSelectionDrag = useCallback(
		(units: DragUnit[], event: DragEvent) => {
			multiSelectionDragRef.current = units;
			dragPreviewElementsRef.current = editor ? resolveDragPreviewElements(editor, units) : null;
			if (!editor || !event.dataTransfer) {
				return;
			}
			event.dataTransfer.effectAllowed = 'move';
			setDragPreviewImage(dragPreviewElementsRef.current ?? [], event);
		},
		[editor],
	);
	const storyBlockDragContext = useMemo(
		() => ({
			sourceRef: storyBlockSourceRef,
			isDragging: isBlockDragging,
			setDragging: setIsBlockDragging,
			activeDropZone,
			setActiveDropZone,
			pendingDropRef,
			beginMultiSelectionDrag,
			endMultiSelectionDrag,
		}),
		[activeDropZone, beginMultiSelectionDrag, endMultiSelectionDrag, isBlockDragging],
	);
	const onElementDragEnd = endMultiSelectionDrag;
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
		selectedBlocks,
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

function resolveDragPreviewElements(editor: Editor, units: DragUnit[]): HTMLElement[] {
	const elements: HTMLElement[] = [];
	for (const unit of units) {
		if (unit.kind === 'block') {
			const element = editor.view.nodeDOM(unit.pos);
			if (element instanceof HTMLElement) {
				elements.push(element);
			}
			continue;
		}
		for (const index of unit.indices) {
			const element = editor.view.dom.querySelector<HTMLElement>(
				`[data-grid-pos="${unit.gridPos}"][data-col-index="${index}"]`,
			);
			if (element) {
				elements.push(element);
			}
		}
	}
	return elements;
}

function setDragPreviewImage(elements: HTMLElement[], event: DragEvent): void {
	if (!event.dataTransfer) {
		return;
	}

	if (elements.length === 0) {
		return;
	}

	const preview = document.createElement('div');
	preview.style.position = 'absolute';
	preview.style.top = '-10000px';
	preview.style.left = '-10000px';

	for (const element of elements) {
		preview.appendChild(cloneElementWithStyles(element));
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
