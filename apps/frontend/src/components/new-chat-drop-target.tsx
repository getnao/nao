import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useStartChatWithStories } from '@/hooks/use-start-chat-with-stories';
import {
	hasAnyStoryReference,
	mayCarryStories,
	NEW_CHAT_DROP_TARGET_ATTRIBUTE,
	readDroppedReferences,
} from '@/lib/story-reference';
import { cn } from '@/lib/utils';
import { useStoryDragOverNewChat } from '@/stores/story-references';

/** Dropping stories or story folders here starts a new chat that references them. */
export function NewChatDropTarget({ children }: { children: ReactNode }) {
	const startChatWithStories = useStartChatWithStories();
	const isStoryDragOver = useStoryDragOverNewChat();
	const [isLinkDragOver, setIsLinkDragOver] = useState(false);

	function handleDragOver(event: DragEvent) {
		if (!mayCarryStories(event.dataTransfer)) {
			return;
		}
		event.preventDefault();
		setIsLinkDragOver(true);
	}

	function handleDrop(event: DragEvent) {
		setIsLinkDragOver(false);
		const references = readDroppedReferences(event.dataTransfer);
		if (!hasAnyStoryReference(references)) {
			return;
		}
		event.preventDefault();
		startChatWithStories(references);
	}

	return (
		<div
			{...{ [NEW_CHAT_DROP_TARGET_ATTRIBUTE]: '' }}
			onDragOver={handleDragOver}
			onDragLeave={() => setIsLinkDragOver(false)}
			onDrop={handleDrop}
			className={cn(
				'rounded-md transition-shadow',
				(isStoryDragOver || isLinkDragOver) && 'ring-2 ring-primary/50 bg-sidebar-accent',
			)}
		>
			{children}
		</div>
	);
}
