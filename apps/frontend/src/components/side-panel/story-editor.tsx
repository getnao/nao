import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { EditorContent } from '@tiptap/react';
import { GripVertical } from 'lucide-react';
import { memo } from 'react';
import { useStoryEditor } from './hooks/use-story-editor';
import { BlockSelectionContext } from './story-block-selection-context';
import { GridDragContext, StoryBlockDragContext } from './story-editor-drag-context';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';

export { preprocessForEditor } from './story-editor-utils';
export { StoryBlockDragGrip, StoryBlockDropZones } from './story-editor-block-drag';

interface StoryEditorProps {
	code: string;
	editorRef: React.MutableRefObject<Editor | null>;
	onSave?: () => void;
}

export const StoryEditor = memo(function StoryEditor({ code, editorRef, onSave }: StoryEditorProps) {
	const {
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
	} = useStoryEditor({ code, editorRef, onSave });

	const hideFloatingHandle =
		handleNodeType === 'gridBlock' || handleNodeType === 'chartBlock' || handleNodeType === 'tableBlock';

	return (
		<GridDragContext.Provider value={gridDragSourceRef}>
			<StoryBlockDragContext.Provider value={storyBlockDragContext}>
				<div ref={storyEditorRef} className='story-editor relative'>
					{editor && (
						<DragHandle
							editor={editor}
							className={cn('drag-handle', hideFloatingHandle && 'pointer-events-none!')}
							onNodeChange={handleDragHandleNodeChange}
							onElementDragStart={onElementDragStart}
							onElementDragEnd={onElementDragEnd}
						>
							<div className='drag-handle-button' onClick={onDragHandleClick}>
								{hideFloatingHandle ? null : <GripVertical className='size-4' />}
							</div>
						</DragHandle>
					)}
					<BlockSelectionContext.Provider value={selectedGridColumns}>
						<EditorContent editor={editor} />
					</BlockSelectionContext.Provider>
				</div>
			</StoryBlockDragContext.Provider>
		</GridDragContext.Provider>
	);
});

export function getEditorMarkdown(editor: Editor): string {
	return editor.getMarkdown();
}
