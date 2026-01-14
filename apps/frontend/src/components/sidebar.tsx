import { PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { ChatList } from './chat-list';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChatListQuery } from '@/queries/useChatListQuery';
import { trpc } from '@/main';

export function Sidebar({ className, ...props }: ComponentProps<'div'>) {
	const chats = useChatListQuery();
	const navigate = useNavigate();
	const { chatId } = useParams({ strict: false });
	const [isCollapsed, setIsCollapsed] = useState(false);
	const deleteChat = useMutation(
		trpc.chat.delete.mutationOptions({
			onSuccess: (_data, _vars, _res, ctx) => {
				navigate({ to: '/' });
				ctx.client.invalidateQueries();
			},
		}),
	);

	const handleStartNewChat = () => {
		navigate({ to: '/' });
	};

	const handleSelectChat = (id: string) => {
		navigate({ to: '/$chatId', params: { chatId: id } });
	};

	const handleDeleteChat = (id: string) => {
		deleteChat.mutate({ chatId: id });
	};

	return (
		<div
			className={cn(
				'flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300',
				isCollapsed ? 'w-14' : 'w-72',
				className,
			)}
			{...props}
		>
			{/* Header */}
			<div className='flex items-center justify-between p-3 border-b border-sidebar-border'>
				{!isCollapsed && <h2 className='font-semibold text-sm'>Chats</h2>}
				<Button
					variant='ghost'
					size='icon-sm'
					onClick={() => setIsCollapsed(!isCollapsed)}
					className={cn(isCollapsed && 'mx-auto')}
				>
					{isCollapsed ? <PanelLeftOpenIcon className='size-4' /> : <PanelLeftCloseIcon className='size-4' />}
					<span className='sr-only'>{isCollapsed ? 'Expand' : 'Collapse'} sidebar</span>
				</Button>
			</div>

			{/* New Chat Button */}
			<div className='p-2 border-b border-sidebar-border'>
				<Button
					variant='outline'
					className={cn('w-full justify-start gap-2', isCollapsed && 'justify-center px-0')}
					onClick={handleStartNewChat}
				>
					<PlusIcon className='size-4' />
					{!isCollapsed && <span>New Chat</span>}
				</Button>
			</div>

			{/* Chat List */}
			{!isCollapsed && (
				<ChatList
					chats={chats.data?.chats || []}
					activeChatId={chatId}
					onChatSelect={handleSelectChat}
					onChatDelete={handleDeleteChat}
				/>
			)}
		</div>
	);
}
