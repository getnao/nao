import { FolderInput } from 'lucide-react';
import { useState } from 'react';

import type { ResolvedStory } from '@/hooks/use-mentioned-stories';
import { FolderPickerDialog } from '@/components/stories-folder-picker-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useMovableStory } from '@/hooks/use-movable-story';

export function StoryMoveToFolderButton({ storyId }: { storyId: string }) {
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const story = useMovableStory(storyId);

	if (!story) {
		return null;
	}

	return (
		<>
			<SimpleTooltip content='Move to folder'>
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='hover:bg-transparent'
					aria-label='Move to folder'
					onClick={() => setIsPickerOpen(true)}
				>
					<FolderInput className='size-3.5' />
				</Button>
			</SimpleTooltip>
			{isPickerOpen && <StoryFolderPickerDialog story={story} onClose={() => setIsPickerOpen(false)} />}
		</>
	);
}

export function StoryMoveToFolderMenuItem({ onSelect }: { onSelect: () => void }) {
	return (
		<DropdownMenuItem onSelect={onSelect}>
			<FolderInput strokeWidth={2.25} />
			<span>Move to folder</span>
		</DropdownMenuItem>
	);
}

export function StoryFolderPickerDialog({ story, onClose }: { story: ResolvedStory; onClose: () => void }) {
	function handleOpenChange(open: boolean) {
		if (!open) {
			onClose();
		}
	}

	return (
		<FolderPickerDialog
			open
			onOpenChange={handleOpenChange}
			target={{ type: 'story', storyId: story.storyId }}
			isOwner={story.isOwner}
		/>
	);
}
