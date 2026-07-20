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
import { getEditorMarkdown, StoryEditor } from './story-editor';
import { StoryTabsBar } from './story-tabs-bar';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';

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

	bufferRef.current = bufferCode;
	activeRef.current = active;

	useEffect(() => {
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

	if (tabs.length === 0) {
		const plainCode = stripStoryTabsMarkup(bufferCode).trim();
		return <StoryEditor code={plainCode} editorRef={editorRef} onSave={onSave} />;
	}

	return (
		<div className='flex flex-col'>
			<div className='sticky top-0 z-10'>
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
	);
}
