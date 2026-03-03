import { ChatListItem } from './sidebar-chat-list-item';
import type { ComponentProps } from 'react';

import type { ChatListItem as ChatListItemType } from '@nao/backend/chat';
import { cn } from '@/lib/utils';

export interface Props extends Omit<ComponentProps<'div'>, 'children'> {
	chats: ChatListItemType[];
	emptyMessage?: string;
}

export function ChatList({ chats, className, emptyMessage = 'No chats yet.', ...props }: Props) {
	const showDefaultSubtitle = emptyMessage === 'No chats yet.';

	if (chats.length === 0) {
		return (
			<div className={cn('flex-1 flex items-center justify-center p-4', className)} {...props}>
				<p className='text-sm text-muted-foreground text-center'>
					{emptyMessage}
					{showDefaultSubtitle && (
						<>
							<br />
							Start a new chat!
						</>
					)}
				</p>
			</div>
		);
	}

	return (
		<div className={cn('flex-1 overflow-y-auto px-2 space-y-1', className)} {...props}>
			{chats.map((chat) => (
				<ChatListItem key={chat.id} chat={chat} />
			))}
		</div>
	);
}
