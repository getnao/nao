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
	resolveActionSelection,
	topLevelBlockPositions,
} from './story-block-selection';
import { StoryTabsBar } from './story-tabs-bar';
import type { DragOrigin } from './story-block-selection';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { StoryEditorSelectionActionsProvider } from '@/contexts/story-editor-selection-actions';

interface StoryTabbedEditorProps {
	code: string;
	editorRef: MutableRefObject<TiptapEditor | null>;
	onSave?: () => void;
	getCodeRef: MutableRefObject<(() => string) | null>;
	barContentClassName?: string;
	contentClassName?: string;
}

export function StoryTabbedEditor({
	code,
	editorRef,
	onSave,
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

	bufferRef.current = bufferCode;
	activeRef.current = active;

	useEffect(() => {
		pendingMovedSelectionRef.current = null;
		setBufferCode(code);
	}, [code]);

	useEffect(() => {
		getCodeRef.current = () => {
			const currentCode = bufferRef.current;
			const currentActive = activeRef.current;
			const editor = editorRef.current;
			const parsed = parseStoryTabs(currentCode);
			const inner = editor ? getEditorMarkdown(editor) : (parsed?.[currentActive]?.innerCode ?? '');
			if (!parsed?.length) {
				return inner;
			}
			return replaceStoryTabInner(currentCode, currentActive, inner);
		};
		return () => {
			getCodeRef.current = null;
		};
	}, [editorRef, getCodeRef]);

	const handleSelect = useCallback(
		(nextIndex: number) => {
			pendingMovedSelectionRef.current = null;
			const editor = editorRef.current;
			const spliced = editor ? replaceStoryTabInner(bufferCode, active, getEditorMarkdown(editor)) : bufferCode;
			setBufferCode(spliced);
			setActiveIndex(nextIndex);
		},
		[active, bufferCode, editorRef],
	);

	const spliceCurrent = () => {
		const editor = editorRef.current;
		return editor ? replaceStoryTabInner(bufferCode, active, getEditorMarkdown(editor)) : bufferCode;
	};
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
			setBufferCode(movedCode);
			setActiveIndex(destinationTabIndex);
		},
		[editorRef],
	);
	const selectionActions = useMemo(
		() => ({
			destinations: tabs.map((tab, index) => ({ index, title: tab.title })).filter((tab) => tab.index !== active),
			moveSelection: handleMoveSelection,
		}),
		[active, handleMoveSelection, tabs],
	);

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
			const movedPositions = positions.slice(currentPending.destinationBlockOffset);
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
				<StoryEditor code={plainCode} editorRef={editorRef} onSave={onSave} />
			</StoryEditorSelectionActionsProvider>
		);
	}

	return (
		<StoryEditorSelectionActionsProvider value={selectionActions}>
			<div className='flex flex-col'>
				<div className='sticky top-0 z-10 bg-background'>
					<StoryTabsBar
						tabs={tabs.map((tab) => ({ title: tab.title }))}
						activeIndex={active}
						onSelect={handleSelect}
						contentClassName={barContentClassName}
						editable={{
							onRename: (index, title) => setBufferCode(renameStoryTab(spliceCurrent(), index, title)),
							onDelete: (index) => {
								const spliced = spliceCurrent();
								setActiveIndex((current) =>
									Math.max(0, current > index ? current - 1 : Math.min(current, tabs.length - 2)),
								);
								setBufferCode(deleteStoryTab(spliced, index));
							},
							onMove: (fromIndex, toIndex) => {
								const spliced = spliceCurrent();
								setBufferCode(moveStoryTab(spliced, fromIndex, toIndex));
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
								const spliced = spliceCurrent();
								setBufferCode(addStoryTab(spliced));
								setActiveIndex(tabs.length);
							},
						}}
					/>
				</div>
				<div className={contentClassName}>
					<StoryEditor code={tabs[active]?.innerCode ?? ''} editorRef={editorRef} onSave={onSave} />
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
	return editor.markdown?.parse(preprocessForEditor(markdown)).content?.length ?? 0;
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
