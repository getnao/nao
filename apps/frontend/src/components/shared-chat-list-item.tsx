import { Link } from './ui/link';
import type { ComponentProps } from 'react';
import type { SharedChatWithDetails } from '@nao/backend/shared-chat';
import { cn } from '@/lib/utils';

export interface Props extends Omit<ComponentProps<'div'>, 'children'> {
	sharedChat: SharedChatWithDetails;
}

export function SharedChatListItem({ sharedChat }: Props) {
	return (
		<Link
			params={{ shareId: sharedChat.id }}
			to='/shared-chat/$shareId'
			className={cn(
				'group relative w-full rounded-md px-3 py-2 transition-[background-color,padding,opacity] min-w-0 flex-1 flex gap-2 items-center',
			)}
			inactiveProps={{
				className: cn('text-sidebar-foreground hover:bg-sidebar-accent opacity-75'),
			}}
			activeProps={{
				className: cn('text-foreground bg-sidebar-accent font-medium'),
			}}
		>
			<div className='truncate text-sm mr-auto'>{sharedChat.title}</div>
			<div className='flex flex-col items-end gap-0.5 shrink-0'>
				<div className='text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis max-w-[60px]'>
					by {sharedChat.authorName}
				</div>
			</div>
		</Link>
	);
}
