import { useState } from 'react';
import type { UIToolPart } from '@nao/backend/chat';
import StoryIcon from '@/components/ui/story-icon';
import { Expandable } from '@/components/ui/expandable';
import { isToolSettled } from '@/lib/ai';
import { useAssistantMessage } from '@/contexts/assistant-message';

const STORY_STATUS_LABELS = {
	create: { pending: 'Creating story', done: 'Created story', failed: 'Could not create story' },
	update: { pending: 'Updating story', done: 'Updated story', failed: 'Could not update story' },
	replace: { pending: 'Refining story', done: 'Refined story', failed: 'Could not refine story' },
	publish: { pending: 'Publishing story', done: 'Published story', failed: 'Could not publish story' },
	delete_files: {
		pending: 'Deleting draft files',
		done: 'Deleted draft files',
		failed: 'Could not delete draft files',
	},
	revert: { pending: 'Reverting draft', done: 'Reverted draft', failed: 'Could not revert draft' },
} as const;

/** An intermediate story action, superseded by a later one on the same story, shown as a one-line status. */
export const StoryStatus = ({
	toolPart,
	withReplayTarget = true,
}: {
	toolPart: UIToolPart<'story'>;
	withReplayTarget?: boolean;
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const { isSettled: isMessageSettled } = useAssistantMessage();
	const isSettled = isMessageSettled || isToolSettled(toolPart);
	const { title, version, error } = getStoryStatusDisplay(toolPart, isSettled);

	const content = (
		<Expandable
			title={title}
			badge={version}
			expanded={isExpanded}
			onExpandedChange={setIsExpanded}
			disabled={!error}
			isLoading={!isSettled}
			triggerClassName='text-foreground disabled:!opacity-100'
			leadingIcon={error ? <div className='size-2 rounded-full bg-red-500' /> : <StoryIcon className='size-3' />}
			variant='inline'
		>
			{error && <pre className='p-2 overflow-auto max-h-80 m-0 whitespace-pre-wrap wrap-break-word'>{error}</pre>}
		</Expandable>
	);

	return withReplayTarget ? <div data-replay-target-id={toolPart.toolCallId}>{content}</div> : content;
};

export const getStoryStatusDisplay = (toolPart: UIToolPart<'story'>, isSettled: boolean) => {
	const error = toolPart.output?.error ?? toolPart.errorText;
	const labels = STORY_STATUS_LABELS[toolPart.input?.action ?? 'create'] ?? STORY_STATUS_LABELS.create;
	const title = !isSettled ? labels.pending : error ? labels.failed : labels.done;
	const version = toolPart.output?.success && toolPart.output.version ? `v${toolPart.output.version}` : undefined;
	return { title, version, error };
};
