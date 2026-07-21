import { popGridColumn } from '@nao/shared/story-segments';
import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import { useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EDITOR_EXTENSIONS } from '../story-editor-extensions';
import { GRID_COLUMN_DRAG_TYPE, STORY_BLOCK_DRAG_TYPE } from '../story-editor-drag-context';
import { createBlockNode, preprocessForEditor, removeCardFromOrigin } from '../story-editor-utils';
import type { GridDragSource, StoryBlockDragSource } from '../story-editor-drag-context';
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
	const [isBlockDragging, setIsBlockDragging] = useState(false);
	const [handleNodeType, setHandleNodeType] = useState<string | null>(null);
	const storyBlockDragContext = useMemo(
		() => ({
			sourceRef: storyBlockSourceRef,
			isDragging: isBlockDragging,
			setDragging: setIsBlockDragging,
		}),
		[isBlockDragging],
	);
	const resetDragContexts = useCallback(() => {
		gridDragSourceRef.current = null;
		storyBlockSourceRef.current = null;
		setIsBlockDragging(false);
	}, []);
	const handleDragHandleNodeChange = useCallback(({ node }: { node: PMNode | null }) => {
		setHandleNodeType(node?.type.name ?? null);
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

	return { editor, gridDragSourceRef, storyBlockDragContext, handleDragHandleNodeChange, handleNodeType };
}
