import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { EditorContent } from '@tiptap/react';
import { GripVertical } from 'lucide-react';
import { memo } from 'react';
import { useStoryEditor } from './hooks/use-story-editor';
import { GridDragContext, StoryBlockDragContext } from './story-editor-drag-context';
import type { Editor } from '@tiptap/react';

export { preprocessForEditor } from './story-editor-utils';
export { StoryBlockDragGrip, StoryBlockDropZones } from './story-editor-block-drag';

interface StoryEditorProps {
	code: string;
	editorRef: React.MutableRefObject<Editor | null>;
	onSave?: () => void;
}

export const StoryEditor = memo(function StoryEditor({ code, editorRef, onSave }: StoryEditorProps) {
	const { editor, gridDragSourceRef, storyBlockDragContext, handleDragHandleNodeChange, handleNodeType } =
		useStoryEditor({ code, editorRef, onSave });

	return (
		<GridDragContext.Provider value={gridDragSourceRef}>
			<StoryBlockDragContext.Provider value={storyBlockDragContext}>
				<div className='story-editor relative'>
					{editor && (
						<DragHandle editor={editor} className='drag-handle' onNodeChange={handleDragHandleNodeChange}>
							{handleNodeType === 'chartBlock' || handleNodeType === 'tableBlock' ? null : (
								<div className='drag-handle-button'>
									<GripVertical className='size-4' />
								</div>
							)}
						</DragHandle>
					)}
					<EditorContent editor={editor} />
				</div>
			</StoryBlockDragContext.Provider>
		</GridDragContext.Provider>
	);
});

export function getEditorMarkdown(editor: Editor): string {
	return editor.getMarkdown();
}
