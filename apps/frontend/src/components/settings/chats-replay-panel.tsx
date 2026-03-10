import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { formatDate } from 'date-fns';

import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { trpc } from '@/main';

type ChatsReplayPanelProps = {
	chatInfo: { chatId: string; userName: string; updatedAt: number } | null;
	onClose: () => void;
};

export function ChatsReplayPanel({ chatInfo, onClose }: ChatsReplayPanelProps) {
	const chatReplayQuery = useQuery(
		trpc.project.getChatReplay.queryOptions(
			{ chatId: chatInfo?.chatId ?? '' },
			{
				enabled: !!chatInfo?.chatId,
			},
		),
	);

	return (
		<div className='w-full flex flex-col'>
			<div className='flex items-center justify-between p-4 border-b'>
				<div className='flex flex-col md:p-4 max-w-4xl mx-16'>
					<h2 className='text-foreground font-semibold text-xl'>Read-Only Chat</h2>
					<p className='text-muted-foreground text-sm'>
						Preview from : <span className='font-semibold'>{chatInfo?.userName}</span> at{' '}
						<span className='font-semibold'>
							{formatDate(new Date(chatInfo?.updatedAt ?? 0), 'dd/MM/yyyy HH:mm')}
						</span>
					</p>
				</div>
				<Button size='icon' variant='ghost' onClick={onClose}>
					<X className='size-4' />
				</Button>
			</div>

			<div className='flex-1 overflow-auto p-4'>
				{!chatInfo?.chatId ? (
					<div className='text-sm text-muted-foreground'>Select a chat to preview.</div>
				) : chatReplayQuery.isLoading ? (
					<div className='text-sm text-muted-foreground'>Loading chat…</div>
				) : chatReplayQuery.isError ? (
					<div className='text-sm text-destructive'>Failed to load chat.</div>
				) : chatReplayQuery.data ? (
					<ReadonlyAgentMessagesProvider messages={chatReplayQuery.data.messages}>
						<ChatMessagesReadonly messages={chatReplayQuery.data.messages} />
					</ReadonlyAgentMessagesProvider>
				) : (
					<div className='text-sm text-muted-foreground'>Select a chat to preview.</div>
				)}
			</div>
		</div>
	);
}
