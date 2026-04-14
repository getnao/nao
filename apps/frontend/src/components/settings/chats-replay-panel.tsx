import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { formatDate } from 'date-fns';

import { SidePanelProvider } from '@/contexts/side-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { SettingsCard } from '@/components/ui/settings-card';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { InlineStatusBar } from '@/components/settings/chats-replay-inline-status-bar';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { ChatViewProvider } from '@/contexts/chat-view';
import { useReplayNav } from '@/hooks/use-replay-nav';
import { useSidePanel } from '@/hooks/use-side-panel';
import { trpc } from '@/main';
import { useSession } from '@/lib/auth-client';

type ChatsReplayPanelProps = {
	chatInfo: {
		chatId: string;
		chatOwnerId: string;
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

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({
		containerRef,
		sidePanelRef,
		defaultWidthRatio: 0.5,
		shouldCollapseSidebar: false,
	});
	const { data: session } = useSession();
	const isOwner = session?.user?.id === chatInfo?.chatOwnerId;

	return (
		<div className='w-full h-full min-h-0 flex flex-col p-4 bg-background'>
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

			<SettingsCard
				rootClassName='flex-1 min-h-0'
				className='flex-1 min-h-0 overflow-hidden bg-muted/30 border p-0'
			>
				{!chatInfo?.chatId ? (
					<div className='flex-1 overflow-auto p-4 text-sm text-muted-foreground'>
						Select a chat to preview.
					</div>
				) : chatReplayQuery.isLoading ? (
					<div className='flex-1 overflow-auto p-4 text-sm text-muted-foreground'>Loading chat…</div>
				) : chatReplayQuery.isError ? (
					<div className='flex-1 overflow-auto p-4 text-sm text-destructive'>Failed to load chat.</div>
				) : chatReplayQuery.data ? (
					<ChatViewProvider expandOnError={true}>
						<ReadonlyAgentMessagesProvider
							messages={chatReplayQuery.data.messages}
							chatId={chatInfo.chatId}
						>
							<SidePanelProvider
								isVisible={sidePanel.isVisible}
								currentStorySlug={sidePanel.currentStorySlug}
								chatId={chatInfo?.chatId}
								isReadonlyMode={!isOwner}
								open={sidePanel.open}
								close={sidePanel.close}
							>
								<div ref={containerRef} className='flex h-full min-h-0'>
									<div ref={scrollContainerRef} className='flex-1 overflow-auto p-4'>
										<ChatMessagesReadonly
											messages={chatReplayQuery.data.messages}
											forkMetadata={chatReplayQuery.data.forkMetadata}
										/>
									</div>
									{sidePanel.content && (
										<SidePanel
											containerRef={containerRef}
											isAnimating={sidePanel.isAnimating}
											sidePanelRef={sidePanelRef}
											resizeHandleRef={sidePanel.resizeHandleRef}
											onClose={sidePanel.close}
										>
											{sidePanel.content}
										</SidePanel>
									)}
								</div>
							</SidePanelProvider>
						</ReadonlyAgentMessagesProvider>
					</ChatViewProvider>
				) : (
					<div className='flex-1 overflow-auto p-4 text-sm text-muted-foreground'>
						Select a chat to preview.
					</div>
				)}
			</SettingsCard>
		</div>
	);
}
