import {
	addStoryTab,
	deleteStoryTab,
	moveStoryTab,
	parseStoryTabs,
	renameStoryTab,
	replaceStoryTabInner,
	stripStoryTabsMarkup,
} from '@nao/shared/story-tabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEditorMarkdown, preprocessForEditor, StoryEditor } from './story-editor';
import {
	blockSelectionPluginKey,
	buildDragUnitTransfer,
	emptySelection,
	resolveActionSelection,
	topLevelBlockPositions,
} from './story-block-selection';
import { StoryTabsBar } from './story-tabs-bar';
import type { DragOrigin } from './story-block-selection';
import type { StoryEditorDragControls } from './story-editor-drag-context';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { StoryEditorSelectionActionsProvider } from '@/contexts/story-editor-selection-actions';

interface StoryTabbedEditorProps {
	code: string;
	editorRef: MutableRefObject<TiptapEditor | null>;
	onSave?: () => void;
	onChange?: (code: string) => void;
	getCodeRef: MutableRefObject<(() => string) | null>;
	barContentClassName?: string;
	contentClassName?: string;
}

export function StoryTabbedEditor({
	code,
	editorRef,
	onSave,
	onChange,
	getCodeRef,
	barContentClassName,
	contentClassName,
}: StoryTabbedEditorProps) {
	const [bufferCode, setBufferCode] = useState(code);
	const [activeIndex, setActiveIndex] = useState(0);
	const tabs = useMemo(() => parseStoryTabs(bufferCode) ?? [], [bufferCode]);
	const active = tabs.length ? Math.min(activeIndex, tabs.length - 1) : 0;
	const bufferRef = useRef(bufferCode);
	const activeRef = useRef(active);
	const pendingMovedSelectionRef = useRef<{ destinationBlockOffset: number; tabIndex: number } | null>(null);
	const editorDragControlsRef = useRef<StoryEditorDragControls | null>(null);
	const onChangeRef = useRef(onChange);

	bufferRef.current = bufferCode;
	activeRef.current = active;
	onChangeRef.current = onChange;

	useEffect(() => {
		pendingMovedSelectionRef.current = null;
		bufferRef.current = code;
		setBufferCode(code);
	}, [code]);

	useEffect(() => {
		getCodeRef.current = () => bufferRef.current;
		return () => {
			getCodeRef.current = null;
		};
	}, [getCodeRef]);

	const updateBuffer = useCallback((nextCode: string) => {
		bufferRef.current = nextCode;
		setBufferCode(nextCode);
		onChangeRef.current?.(nextCode);
	}, []);

	const getCurrentBuffer = useCallback(() => {
		const currentCode = bufferRef.current;
		const editor = editorRef.current;
		const currentTabs = parseStoryTabs(currentCode);
		if (!editor || !currentTabs?.[activeRef.current]) {
			return currentCode;
		}
		const editorMarkdown = getEditorMarkdown(editor);
		return currentTabs[activeRef.current].innerCode === editorMarkdown
			? currentCode
			: replaceStoryTabInner(currentCode, activeRef.current, editorMarkdown);
	}, [editorRef]);

	const handleSelect = useCallback(
		(nextIndex: number) => {
			pendingMovedSelectionRef.current = null;
			const editor = editorRef.current;
			if (editor) {
				editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, emptySelection()));
			}
			const currentCode = getCurrentBuffer();
			if (currentCode !== bufferRef.current) {
				updateBuffer(currentCode);
			}
			setActiveIndex(nextIndex);
		},
		[editorRef, getCurrentBuffer, updateBuffer],
	);

	const handleEditorChange = useCallback(
		(innerCode: string) => {
			const currentCode = bufferRef.current;
			const parsed = parseStoryTabs(currentCode);
			const nextCode = parsed?.length
				? replaceStoryTabInner(currentCode, activeRef.current, innerCode)
				: innerCode;
			updateBuffer(nextCode);
		},
		[updateBuffer],
	);

	const handleMoveSelection = useCallback(
		(origin: DragOrigin, destinationTabIndex: number) => {
			const currentCode = bufferRef.current;
			const sourceTabIndex = activeRef.current;
			const editor = editorRef.current;
			const currentTabs = parseStoryTabs(currentCode);
			if (
				!editor ||
				!currentTabs?.length ||
				destinationTabIndex < 0 ||
				destinationTabIndex >= currentTabs.length ||
				destinationTabIndex === sourceTabIndex
			) {
				return;
			}

			const units = resolveActionSelection(editor.state, origin);
			const transfer = buildDragUnitTransfer(editor.state, units);
			const movedMarkdown = transfer ? serializeMovedNodes(editor, transfer.nodes) : '';
			if (!transfer || !movedMarkdown) {
				return;
			}
			const destinationBlockOffset = getMarkdownBlockCount(editor, currentTabs[destinationTabIndex].innerCode);

			editor.view.dispatch(transfer.transaction);
			const sourceUpdated = replaceStoryTabInner(currentCode, sourceTabIndex, getEditorMarkdown(editor));
			const updatedTabs = parseStoryTabs(sourceUpdated);
			if (!updatedTabs?.[destinationTabIndex]) {
				return;
			}
			const destinationInner = appendMarkdown(updatedTabs[destinationTabIndex].innerCode, movedMarkdown);
			const movedCode = replaceStoryTabInner(sourceUpdated, destinationTabIndex, destinationInner);
			pendingMovedSelectionRef.current = {
				destinationBlockOffset,
				tabIndex: destinationTabIndex,
			};
			updateBuffer(movedCode);
			setActiveIndex(destinationTabIndex);
		},
		[editorRef, updateBuffer],
	);
	const selectionActions = useMemo(
		() => ({
			destinations: tabs.map((tab, index) => ({ index, title: tab.title })).filter((tab) => tab.index !== active),
			moveSelection: handleMoveSelection,
		}),
		[active, handleMoveSelection, tabs],
	);
	const handleDragControlsChange = useCallback((controls: StoryEditorDragControls | null) => {
		editorDragControlsRef.current = controls;
	}, []);
	const deactivateEditorDropTargets = useCallback(() => {
		editorDragControlsRef.current?.deactivateDropTargets();
	}, []);

	useEffect(() => {
		const pending = pendingMovedSelectionRef.current;
		if (!pending || pending.tabIndex !== active) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			const editor = editorRef.current;
			const currentPending = pendingMovedSelectionRef.current;
			if (!editor || !currentPending || currentPending.tabIndex !== activeRef.current) {
				return;
			}
			const positions = topLevelBlockPositions(editor.state.doc);
			const movedPositions = trimTrailingEmptyParagraphs(
				editor.state.doc,
				positions.slice(currentPending.destinationBlockOffset),
			);
			if (!movedPositions.length) {
				pendingMovedSelectionRef.current = null;
				return;
			}
			editor.view.dispatch(
				editor.state.tr.setMeta(blockSelectionPluginKey, {
					blocks: movedPositions,
					gridColumns: [],
					anchor: movedPositions[0] ?? null,
					columnAnchor: null,
				}),
			);
			editor.view.focus();
			const scrollPosition = findLastContentPosition(editor, movedPositions);
			const dom = editor.view.nodeDOM(scrollPosition);
			const element = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
			element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			pendingMovedSelectionRef.current = null;
		});
		return () => cancelAnimationFrame(frame);
	}, [active, bufferCode, editorRef]);

	if (tabs.length === 0) {
		const plainCode = stripStoryTabsMarkup(bufferCode).trim();
		return (
			<StoryEditorSelectionActionsProvider value={selectionActions}>
				<StoryEditor
					code={plainCode}
					editorRef={editorRef}
					onSave={onSave}
					onDragControlsChange={handleDragControlsChange}
					onChange={handleEditorChange}
				/>
			</StoryEditorSelectionActionsProvider>
		);
	}

	return (
		<StoryEditorSelectionActionsProvider value={selectionActions}>
			<div className='flex flex-col'>
				<div className='sticky top-0 z-50 bg-background'>
					<StoryTabsBar
						tabs={tabs.map((tab) => ({ title: tab.title }))}
						activeIndex={active}
						onSelect={handleSelect}
						contentClassName={barContentClassName}
						externalDrop={{
							onDrop: handleMoveSelection,
							onTargetActivate: deactivateEditorDropTargets,
						}}
						editable={{
							onRename: (index, title) => updateBuffer(renameStoryTab(getCurrentBuffer(), index, title)),
							onDelete: (index) => {
								const currentCode = getCurrentBuffer();
								setActiveIndex((current) =>
									Math.max(0, current > index ? current - 1 : Math.min(current, tabs.length - 2)),
								);
								updateBuffer(deleteStoryTab(currentCode, index));
							},
							onMove: (fromIndex, toIndex) => {
								updateBuffer(moveStoryTab(getCurrentBuffer(), fromIndex, toIndex));
								setActiveIndex((current) => {
									if (current === fromIndex) {
										return toIndex;
									}
									let next = current > fromIndex ? current - 1 : current;
									if (toIndex <= next) {
										next += 1;
									}
									return next;
								});
							},
							onAdd: () => {
								updateBuffer(addStoryTab(getCurrentBuffer()));
								setActiveIndex(tabs.length);
							},
						}}
					/>
				</div>
				<div className={contentClassName}>
					<StoryEditor
						code={tabs[active]?.innerCode ?? ''}
						editorRef={editorRef}
						onSave={onSave}
						onDragControlsChange={handleDragControlsChange}
						onChange={handleEditorChange}
					/>
				</div>
			</div>
		</StoryEditorSelectionActionsProvider>
	);
}

function serializeMovedNodes(editor: TiptapEditor, nodes: readonly PMNode[]): string {
	return (
		editor.markdown
			?.serialize({
				type: 'doc',
				content: nodes.map((node) => node.toJSON()),
			})
			.trim() ?? ''
	);
}

function getMarkdownBlockCount(editor: TiptapEditor, markdown: string): number {
	const content = editor.markdown?.parse(preprocessForEditor(markdown)).content ?? [];
	let end = content.length;
	while (end > 0) {
		const node = content[end - 1];
		if (node.type !== 'paragraph' || node.content?.length) {
			break;
		}
		end -= 1;
	}
	return end;
}

function trimTrailingEmptyParagraphs(doc: PMNode, positions: number[]): number[] {
	let end = positions.length;
	while (end > 0) {
		const node = doc.nodeAt(positions[end - 1]);
		if (node?.type.name !== 'paragraph' || node.content.size > 0) {
			break;
		}
		end -= 1;
	}
	return positions.slice(0, end);
}

function findLastContentPosition(editor: TiptapEditor, positions: number[]): number {
	for (let index = positions.length - 1; index >= 0; index -= 1) {
		const position = positions[index];
		const node = editor.state.doc.nodeAt(position);
		if (node && (node.type.name !== 'paragraph' || node.content.size > 0)) {
			return position;
		}
	}
	return positions.at(-1) ?? 0;
}

function appendMarkdown(code: string, markdown: string): string {
	const existing = code.trim();
	return existing ? `${existing}\n\n${markdown}` : markdown;
}
