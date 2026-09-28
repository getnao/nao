import { X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import {
	BLOCK_EDIT_DESCRIPTION,
	CustomStoryBlockEditForm,
	CustomStoryTableFormatForm,
	TABLE_FORMAT_EDIT_DESCRIPTION,
} from '@/components/custom-story/custom-story-block-edit';
import { Button } from '@/components/ui/button';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { storyBlockEditStore } from '@/stores/story-block-edit';

export function StoryBlockEditPanel({ chatId }: { chatId: string }) {
	const target = useSyncExternalStore(storyBlockEditStore.subscribe, storyBlockEditStore.getSnapshot);
	const { running: isRunning } = useChatActivity(chatId);
	const { isVisible, currentStorySlug } = useSidePanel();
	const isStale =
		target !== null && (target.chatId !== chatId || !isVisible || target.storySlug !== currentStorySlug);

	useEffect(() => {
		if (isRunning || isStale) {
			storyBlockEditStore.close();
		}
	}, [isRunning, isStale]);

	if (!target || isRunning || isStale) {
		return null;
	}

	return (
		<div
			className='absolute inset-x-0 top-0 z-20 flex flex-col border-b bg-background shadow-sm'
			style={{ bottom: 'var(--chat-input-height)' }}
			data-selection-ignore
		>
			<div className='flex shrink-0 items-start justify-between gap-2 px-6 pt-4 pb-2'>
				<div className='min-w-0'>
					<div className='text-sm font-semibold'>
						{target.kind === 'table' ? 'Edit table formatting' : 'Edit chart'}
					</div>
					<div className='text-xs text-muted-foreground'>
						{target.kind === 'table' ? TABLE_FORMAT_EDIT_DESCRIPTION : BLOCK_EDIT_DESCRIPTION}
					</div>
				</div>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={storyBlockEditStore.close}
					aria-label='Close'
				>
					<X className='size-3.5' />
				</Button>
			</div>
			<div className='min-h-0 flex-1 overflow-y-auto px-6 pb-4'>
				{target.kind === 'table' ? (
					<CustomStoryTableFormatForm
						key={target.id}
						target={target}
						onCancel={storyBlockEditStore.close}
						onSaved={storyBlockEditStore.close}
					/>
				) : (
					<CustomStoryBlockEditForm
						key={target.id}
						target={target}
						onCancel={storyBlockEditStore.close}
						onSaved={storyBlockEditStore.close}
					/>
				)}
			</div>
		</div>
	);
}
