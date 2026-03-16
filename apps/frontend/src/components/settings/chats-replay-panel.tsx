import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { formatDate } from 'date-fns';

import { SettingsCard } from '@/components/ui/settings-card';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { InlineStatusBar } from '@/components/settings/chats-replay-inline-status-bar';
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
		currentFeedbackVote,
		toolErrorCurrent,
		toolErrorTotal,
	} = useReplayNav(scrollContainerRef, contentReady);

	return (
		<div className='w-full h-full min-h-0 flex flex-col p-4 bg-white'>
			<div className='flex items-center justify-between'>
				<div className='flex flex-col md:p-4 max-w-4xl'>
					<h2 className='text-foreground font-semibold text-xl'>Chat by {chatInfo?.userName ?? '—'}</h2>
					<span className='text-muted-foreground text-xs font-semibold'>
						{chatInfo?.updatedAt != null ? formatDate(new Date(chatInfo.updatedAt), 'yyyy-MM-dd') : '—'}
					</span>
				</div>
				<div className='flex items-center gap-2'>
					{chatInfo?.chatId && chatReplayQuery.data && (
						<InlineStatusBar
							feedbackCurrent={feedbackCurrent}
							feedbackTotal={feedbackTotal}
							feedbackVote={currentFeedbackVote}
							errorCurrent={toolErrorCurrent}
							errorTotal={toolErrorTotal}
							onPrevFeedback={goToPrevFeedback}
							onNextFeedback={goToNextFeedback}
							onPrevError={goToPrevToolError}
							onNextError={goToNextToolError}
						/>
					)}
					<Button size='icon' variant='ghost' onClick={onClose}>
						<X className='size-4' />
					</Button>
				</div>
			</div>

			<SettingsCard rootClassName='flex-1 min-h-0' className='flex-1 min-h-0 overflow-hidden bg-muted/30 border'>
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
			</SettingsCard>
		</div>
	);
}
