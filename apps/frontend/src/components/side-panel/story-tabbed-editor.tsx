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
import { StoryEditor } from './story-editor';
import { StoryTabsBar } from './story-tabs-bar';
import type { MutableRefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';

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
	const onChangeRef = useRef(onChange);

	bufferRef.current = bufferCode;
	activeRef.current = active;
	onChangeRef.current = onChange;

	useEffect(() => {
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

	const handleSelect = useCallback((nextIndex: number) => {
		setActiveIndex(nextIndex);
	}, []);

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

	if (tabs.length === 0) {
		const plainCode = stripStoryTabsMarkup(bufferCode).trim();
		return <StoryEditor code={plainCode} editorRef={editorRef} onSave={onSave} onChange={handleEditorChange} />;
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
						onRename: (index, title) => updateBuffer(renameStoryTab(bufferRef.current, index, title)),
						onDelete: (index) => {
							setActiveIndex((current) =>
								Math.max(0, current > index ? current - 1 : Math.min(current, tabs.length - 2)),
							);
							updateBuffer(deleteStoryTab(bufferRef.current, index));
						},
						onMove: (fromIndex, toIndex) => {
							updateBuffer(moveStoryTab(bufferRef.current, fromIndex, toIndex));
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
							updateBuffer(addStoryTab(bufferRef.current));
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
					onChange={handleEditorChange}
				/>
			</div>
		</div>
	);
}
