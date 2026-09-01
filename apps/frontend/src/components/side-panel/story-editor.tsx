import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { EditorContent } from '@tiptap/react';
import { memo } from 'react';
import { StoryBlockActionGrip } from './story-editor-block-drag';
import { useStoryEditor } from './hooks/use-story-editor';
import { BlockSelectionContext, SelectedBlockPositionsContext } from './story-block-selection-context';
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
		selectedBlocks,
		handleDragHandleNodeChange,
		handleNodeType,
		storyEditorRef,
		onElementDragStart,
		onElementDragEnd,
		getDragHandleOrigin,
	} = useStoryEditor({ code, editorRef, onSave });

	const hideFloatingHandle =
		handleNodeType === 'gridBlock' ||
		handleNodeType === 'chartBlock' ||
		handleNodeType === 'tableBlock' ||
		handleNodeType === 'mapBlock';

	return (
		<GridDragContext.Provider value={gridDragSourceRef}>
			<StoryBlockDragContext.Provider value={storyBlockDragContext}>
				<div
					ref={storyEditorRef}
					className={cn(
						'story-editor relative',
						storyBlockDragContext.activeDropZone && 'drop-indicator-active',
					)}
				>
					{editor && (
						<DragHandle
							editor={editor}
							className={cn('drag-handle', hideFloatingHandle && 'pointer-events-none!')}
							onNodeChange={handleDragHandleNodeChange}
							onElementDragStart={onElementDragStart}
							onElementDragEnd={onElementDragEnd}
						>
							<StoryBlockActionGrip
								editor={editor}
								getOrigin={getDragHandleOrigin}
								ariaLabel='Move story block'
								iconClassName='size-4'
								lockHandleWhileOpen
								wrapperClassName={cn('drag-handle-button', hideFloatingHandle && 'invisible')}
							/>
						</DragHandle>
					)}
					<BlockSelectionContext.Provider value={selectedGridColumns}>
						<SelectedBlockPositionsContext.Provider value={selectedBlocks}>
							<EditorContent editor={editor} />
						</SelectedBlockPositionsContext.Provider>
					</BlockSelectionContext.Provider>
				</div>
			</StoryBlockDragContext.Provider>
		</GridDragContext.Provider>
	);
});

export function getEditorMarkdown(editor: Editor): string {
	return editor.getMarkdown();
}
