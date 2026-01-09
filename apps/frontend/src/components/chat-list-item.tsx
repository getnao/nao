import { MessageSquareIcon, TrashIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import type { ChatListItem } from 'backend/chat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface Props extends Omit<ComponentProps<'div'>, 'children'> {
	chat: ChatListItem;
	isActive: boolean;
	onChatSelect: (id: string) => void;
	onChatDelete: (id: string) => void;
}

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ago`;
	}
	if (hours > 0) {
		return `${hours}h ago`;
	}
	if (minutes > 0) {
		return `${minutes}m ago`;
	}
	return 'Just now';
}

export function ChatListItem({ chat, isActive, onChatSelect, onChatDelete, className, ...props }: Props) {
	return (
		<div
			role='button'
			tabIndex={0}
			className={cn(
				'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer',
				'hover:bg-sidebar-accent',
				isActive && 'bg-sidebar-accent',
				className,
			)}
			onClick={() => onChatSelect(chat.id)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onChatSelect(chat.id);
				}
			}}
			{...props}
		>
			<MessageSquareIcon className='size-4 shrink-0 text-muted-foreground' />
			<div className='min-w-0 flex-1'>
				<p className='truncate text-sm font-medium'>{chat.title}</p>
				<p className='text-xs text-muted-foreground'>{formatRelativeTime(chat.updatedAt)}</p>
			</div>
			<Button
				variant='ghost'
				size='icon-sm'
				className='opacity-0 group-hover:opacity-100 transition-opacity shrink-0 size-7'
				onClick={(e) => {
					e.stopPropagation();
					onChatDelete(chat.id);
				}}
			>
				<TrashIcon className='size-3.5 text-muted-foreground hover:text-destructive' />
				<span className='sr-only'>Delete chat</span>
			</Button>
		</div>
	);
}
