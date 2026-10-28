import { BULK_ITEMS_LIMIT } from '@nao/shared';
import { ArchiveIcon, ArchiveRestoreIcon, FolderInput, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContentCenteredStyle } from '@/hooks/use-sidebar-content-offset';
import { cn } from '@/lib/utils';

export function StoriesSelectionBar({
	selectedCount,
	limitReached = false,
	showArchived,
	isPending,
	onArchive,
	onUnarchive,
	onMove,
	onStartChat,
	onCancel,
}: {
	selectedCount: number;
	limitReached?: boolean;
	showArchived: boolean;
	isPending: boolean;
	onArchive: () => void;
	onUnarchive: () => void;
	onMove: () => void;
	onStartChat: () => void;
	onCancel: () => void;
}) {
	const centeredStyle = useContentCenteredStyle();

	if (selectedCount === 0) {
		return null;
	}

	return (
		<div
			style={centeredStyle}
			className={cn(
				'fixed bottom-6 -translate-x-1/2 z-50 transition-[left] duration-300',
				'flex items-center gap-3 px-4 py-2.5 rounded-full',
				'bg-background border shadow-lg',
			)}
		>
			<span className='text-sm font-medium text-foreground tabular-nums'>{selectedCount} selected</span>
			{limitReached && (
				<span className='text-xs text-muted-foreground'>
					Please select max {BULK_ITEMS_LIMIT} stories and {BULK_ITEMS_LIMIT} folders
				</span>
			)}
			<div className='w-px h-4 bg-border' />
			{showArchived ? (
				<Button
					size='sm'
					variant='ghost'
					onClick={onUnarchive}
					disabled={isPending}
					className='gap-1.5 h-7 text-xs rounded-full'
				>
					<ArchiveRestoreIcon className='size-3.5' />
					Restore
				</Button>
			) : (
				<>
					<Button
						size='sm'
						variant='ghost'
						onClick={onStartChat}
						disabled={isPending}
						className='gap-1.5 h-7 text-xs rounded-full'
					>
						<MessageSquarePlus className='size-3.5' />
						New chat
					</Button>
					<Button
						size='sm'
						variant='ghost'
						onClick={onMove}
						disabled={isPending}
						className='gap-1.5 h-7 text-xs rounded-full'
					>
						<FolderInput className='size-3.5' />
						Move
					</Button>
					<Button
						size='sm'
						variant='ghost'
						onClick={onArchive}
						disabled={isPending}
						className='gap-1.5 h-7 text-xs rounded-full'
					>
						<ArchiveIcon className='size-3.5' />
						Archive
					</Button>
				</>
			)}
			<Button
				size='icon-xs'
				variant='ghost'
				onClick={onCancel}
				disabled={isPending}
				aria-label='Cancel selection'
				className='rounded-full hover:rounded-full'
			>
				<X className='size-3.5' />
			</Button>
		</div>
	);
}
