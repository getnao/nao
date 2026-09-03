import { useRef } from 'react';
import { parseStoryTabs } from '@nao/shared/story-tabs';
import type { ReactNode } from 'react';

import type { QueryDataMap } from '@/components/story-embeds';
import type { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useDragAutoScroll } from '@/hooks/use-drag-auto-scroll';
import { StoryCodeView } from '@/components/side-panel/story-code-view';
import { StoryEditor } from '@/components/side-panel/story-editor';
import { StoryTabbedEditor } from '@/components/side-panel/story-tabbed-editor';
import { StoryUnsavedChangesDialog } from '@/components/story-unsaved-changes-dialog';
import { StoryEmbedDataProvider } from '@/contexts/story-embed-data';

interface StoryPageBodyProps {
	editor: ReturnType<typeof useStoryPageEditor>;
	preview: ReactNode;
	queryData?: QueryDataMap | null;
}

export function StoryPageBody({ editor, preview, queryData }: StoryPageBodyProps) {
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	useDragAutoScroll(scrollContainerRef);
	const unsavedChangesDialog = <StoryUnsavedChangesDialog {...editor.exitDialog} />;

	if (editor.viewMode === 'edit') {
		const editCode = editor.editCode;
		const tabs = parseStoryTabs(editCode);
		const isTabbed = Boolean(tabs?.length);
		return (
			<>
				<StoryEmbedDataProvider value={queryData ?? null}>
					<div ref={scrollContainerRef} className='flex-1 min-h-0 overflow-auto'>
						{isTabbed ? (
							<StoryTabbedEditor
								code={editCode}
								editorRef={editor.tiptapEditorRef}
								onSave={editor.handleSave}
								onChange={editor.onEditCodeChange}
								getCodeRef={editor.tabbedEditCodeRef}
								barContentClassName='mx-auto w-full max-w-5xl px-4 md:px-8'
								contentClassName='max-w-5xl mx-auto p-4 md:p-8'
							/>
						) : (
							<div className='max-w-5xl mx-auto p-4 md:p-8'>
								<StoryEditor
									code={editCode}
									editorRef={editor.tiptapEditorRef}
									onSave={editor.handleSave}
									onChange={editor.onEditCodeChange}
								/>
							</div>
						)}
					</div>
				</StoryEmbedDataProvider>
				{unsavedChangesDialog}
			</>
		);
	}

	if (editor.viewMode === 'code') {
		const codeDraft = editor.codeDraft;
		return (
			<>
				<div className='flex-1 min-h-0'>
					<StoryCodeView
						code={codeDraft}
						codeRef={editor.codeViewRef}
						onCodeChange={editor.onCodeChange}
						onValidChange={editor.setIsCodeValid}
						onSave={editor.handleSave}
					/>
				</div>
				{unsavedChangesDialog}
			</>
		);
	}

	return (
		<>
			{preview}
			{unsavedChangesDialog}
		</>
	);
}
