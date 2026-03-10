import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { formatDate } from 'date-fns';

import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { useReplayNav } from '@/hooks/use-replay-nav';
import { trpc } from '@/main';

type ChatsReplayPanelProps = {
	chatInfo: {
		chatId: string;
		userName: string;
		updatedAt: number;
		feedbackCount: number;
		feedbackText: string;
		toolErrorCount: number;
	} | null;
	onClose: () => void;
};

export function ChatsReplayPanel({ chatInfo, onClose }: ChatsReplayPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const chatReplayQuery = useQuery(
		trpc.project.getChatReplay.queryOptions(
			{ chatId: chatInfo?.chatId ?? '' },
			{
				enabled: !!chatInfo?.chatId,
			},
		),
	);

	const contentReady = !!chatReplayQuery.data;
	const {
		goToPrevFeedback,
		goToNextFeedback,
		goToPrevToolError,
		goToNextToolError,
		feedbackCurrent,
		feedbackTotal,
		toolErrorCurrent,
		toolErrorTotal,
	} = useReplayNav(scrollContainerRef, contentReady);

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
				<div className='flex items-center gap-2'>
					{chatInfo?.chatId && chatReplayQuery.data && (
						<>
							<div className='flex items-center gap-1' title='Go to previous/next feedback (votes)'>
								<div className='flex items-center flex-col'>
									<span className='text-xs text-muted-foreground'>Feedback</span>
									<span className='text-xs text-muted-foreground'>
										{feedbackCurrent}/{feedbackTotal}
									</span>
								</div>

								<div className='flex border rounded-md p-0.5'>
									<Button
										size='icon'
										variant='ghost'
										className='size-8'
										onClick={goToPrevFeedback}
										aria-label='Previous feedback'
									>
										<ChevronUp className='size-4' />
									</Button>
									<Button
										size='icon'
										variant='ghost'
										className='size-8'
										onClick={goToNextFeedback}
										aria-label='Next feedback'
									>
										<ChevronDown className='size-4' />
									</Button>
								</div>
							</div>
							<div className='flex items-center gap-1' title='Go to previous/next tool error'>
								<div className='flex items-center flex-col'>
									<span className='text-xs text-muted-foreground'>Error</span>
									<span className='text-xs text-muted-foreground'>
										{toolErrorCurrent}/{toolErrorTotal}
									</span>
								</div>
								<div className='flex border rounded-md p-0.5'>
									<Button
										size='icon'
										variant='ghost'
										className='size-8'
										onClick={goToPrevToolError}
										aria-label='Previous tool error'
									>
										<ChevronUp className='size-4' />
									</Button>
									<Button
										size='icon'
										variant='ghost'
										className='size-8'
										onClick={goToNextToolError}
										aria-label='Next tool error'
									>
										<ChevronDown className='size-4' />
									</Button>
								</div>
							</div>
						</>
					)}
					<Button size='icon' variant='ghost' onClick={onClose}>
						<X className='size-4' />
					</Button>
				</div>
			</div>

			<div ref={scrollContainerRef} className='flex-1 overflow-auto p-4'>
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
