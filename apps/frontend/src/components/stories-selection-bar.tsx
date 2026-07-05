import { BULK_ITEMS_LIMIT } from '@nao/shared';
import { ArchiveIcon, ArchiveRestoreIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StoriesSelectionBar({
	selectedCount,
	limitReached = false,
	showArchived,
	isPending,
	onArchive,
	onUnarchive,
	onCancel,
}: {
	selectedCount: number;
	limitReached?: boolean;
	showArchived: boolean;
	isPending: boolean;
	onArchive: () => void;
	onUnarchive: () => void;
	onCancel: () => void;
}) {
	if (selectedCount === 0) {
		return null;
	}

	return (
		<div
			className={cn(
				'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
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
