import { ChatListItem } from './chat-list-item';
import type { ComponentProps } from 'react';

import type { ChatListItem as ChatListItemType } from 'backend/chat';
import { cn } from '@/lib/utils';

export interface Props extends Omit<ComponentProps<'div'>, 'children'> {
	chats: ChatListItemType[];
	activeChatId: string | undefined;
	onChatSelect: (id: string) => void;
	onChatDelete: (id: string) => void;
}

export function ChatList({ chats, activeChatId, onChatSelect, onChatDelete, className, ...props }: Props) {
	if (chats.length === 0) {
		return (
			<div className={cn('flex-1 flex items-center justify-center p-4', className)} {...props}>
				<p className='text-sm text-muted-foreground text-center'>
					No chats yet.
					<br />
					Start a new chat!
				</p>
			</div>
		);
	}

	return (
		<div className={cn('flex-1 overflow-y-auto p-2 space-y-1', className)} {...props}>
			{chats.map((chat) => (
				<ChatListItem
					key={chat.id}
					chat={chat}
					isActive={chat.id === activeChatId}
					onChatSelect={onChatSelect}
					onChatDelete={onChatDelete}
				/>
			))}
		</div>
	);
}
