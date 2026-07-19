import { parseStoryTabs } from '@nao/shared/story-tabs';
import type { ReactNode } from 'react';

import type { QueryDataMap } from '@/components/story-embeds';
import type { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { StoryCodeView } from '@/components/side-panel/story-code-view';
import { StoryEditor } from '@/components/side-panel/story-editor';
import { StoryTabbedEditor } from '@/components/side-panel/story-tabbed-editor';
import { StoryEmbedDataProvider } from '@/contexts/story-embed-data';

interface StoryPageBodyProps {
	code: string;
	editor: ReturnType<typeof useStoryPageEditor>;
	preview: ReactNode;
	queryData?: QueryDataMap | null;
}

export function StoryPageBody({ code, editor, preview, queryData }: StoryPageBodyProps) {
	if (editor.viewMode === 'edit') {
		const tabs = parseStoryTabs(code);
		const isTabbed = Boolean(tabs?.length);
		return (
			<StoryEmbedDataProvider value={queryData ?? null}>
				<div className='flex-1 min-h-0 overflow-auto'>
					{isTabbed ? (
						<StoryTabbedEditor
							code={code}
							editorRef={editor.tiptapEditorRef}
							onSave={editor.handleSave}
							getCodeRef={editor.tabbedEditCodeRef}
							barContentClassName='mx-auto w-full max-w-5xl px-4 md:px-8'
							contentClassName='max-w-5xl mx-auto p-4 md:p-8'
						/>
					) : (
						<div className='max-w-5xl mx-auto p-4 md:p-8'>
							<StoryEditor code={code} editorRef={editor.tiptapEditorRef} onSave={editor.handleSave} />
						</div>
					)}
				</div>
			</StoryEmbedDataProvider>
		);
	}

	if (editor.viewMode === 'code') {
		return (
			<div className='flex-1 min-h-0'>
				<StoryCodeView
					code={code}
					codeRef={editor.codeViewRef}
					onDirtyChange={editor.setIsCodeDirty}
					onValidChange={editor.setIsCodeValid}
					onSave={editor.handleSave}
				/>
			</div>
		);
	}

	return <>{preview}</>;
}
