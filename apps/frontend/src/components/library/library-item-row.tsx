import { AtSign, GripVertical } from 'lucide-react';
import { LibraryItemIcon } from './library-item-icon';
import type { LibraryItem } from '@/lib/library';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getTimeAgo } from '@/lib/time-ago';
import { describeLibraryItem, writeLibraryDragData } from '@/lib/library';

interface LibraryItemRowProps {
	item: LibraryItem;
	onOpen: (item: LibraryItem) => void;
	onMention: (item: LibraryItem) => void;
}

export function LibraryItemRow({ item, onOpen, onMention }: LibraryItemRowProps) {
	const description = describeLibraryItem(item);

	return (
		<div
			draggable
			onDragStart={(event) => writeLibraryDragData(event.dataTransfer, item)}
			className='group/row relative flex items-center rounded-lg hover:bg-accent'
		>
			<GripVertical className='absolute left-0.5 size-3 cursor-grab text-muted-foreground/60 opacity-0 group-hover/row:opacity-100' />
			<button
				type='button'
				onClick={() => onOpen(item)}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1.5 pl-4 pr-2 text-left'
			>
				<span className='flex size-7 shrink-0 items-center justify-center rounded-md border bg-background'>
					<LibraryItemIcon item={item} className='size-3.5' />
				</span>
				<span className='min-w-0 flex-1'>
					<span className='block truncate text-sm'>{item.name}</span>
					{description && <span className='block truncate text-xs text-muted-foreground'>{description}</span>}
				</span>
				<span className='shrink-0 text-[11px] tabular-nums text-muted-foreground group-hover/row:hidden'>
					{getTimeAgo(item.updatedAt).humanReadable}
				</span>
			</button>
			<SimpleTooltip content='Mention in chat' side='left'>
				<button
					type='button'
					onClick={() => onMention(item)}
					aria-label={`Mention ${item.name} in chat`}
					className='mr-2 hidden size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover/row:flex'
				>
					<AtSign className='size-3.5' />
				</button>
			</SimpleTooltip>
		</div>
	);
}
