import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { formatDate } from 'date-fns';
import type { ReactNode } from 'react';
import type { StickToBottomContext } from 'use-stick-to-bottom';

import type { ReplayHighlight } from '@/components/settings/usage-route-search';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { SettingsCard } from '@/components/ui/settings-card';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { InlineStatusBar } from '@/components/settings/chats-replay-inline-status-bar';
import { ReplayContextWindowRing } from '@/components/ui/chat-input-context-window-ring';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { ChatViewProvider } from '@/contexts/chat-view';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { useReplayNav } from '@/hooks/use-replay-nav';
import { useSidePanel } from '@/hooks/use-side-panel';
import { trpc } from '@/main';
import { useSession } from '@/lib/auth-client';

type ChatsReplayPanelProps = {
	chatId: string;
	onBack: () => void;
	metadataAction?: ReactNode;
	highlightOnLoad?: ReplayHighlight;
	targetId?: string;
};

export function ChatsReplayPanel({ chatId, onBack, metadataAction, highlightOnLoad, targetId }: ChatsReplayPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const chatReplayQuery = useQuery(
		trpc.project.getChatReplay.queryOptions(
			{ chatId },
			{
				enabled: !!chatId,
			},
		),
	);

	const contentReady = !!chatReplayQuery.data;
	const stickContextRef = useRef<StickToBottomContext | null>(null);
	const escapeStickLock = useCallback(() => stickContextRef.current?.stopScroll(), []);
	const {
		highlightTarget,
		goToPrevFeedback,
		goToNextFeedback,
		goToPrevToolError,
		goToNextToolError,
		feedbackCurrent,
		feedbackTotal,
		currentFeedbackVote,
		toolErrorCurrent,
		toolErrorTotal,
	} = useReplayNav(scrollContainerRef, contentReady, escapeStickLock);

	const didAutoHighlight = useRef(false);

	useEffect(() => {
		if (!contentReady || didAutoHighlight.current) {
			return;
		}
		const container = scrollContainerRef.current;
		if (!container) {
			return;
		}
		if (targetId) {
			const target = container.querySelector<HTMLElement>(`[data-replay-target-id="${targetId}"]`);
			if (target) {
				didAutoHighlight.current = true;
				highlightTarget(target);
				return;
			}
		}
		if (!highlightOnLoad) {
			return;
		}
		const targetTotal = highlightOnLoad === 'tool-error' ? toolErrorTotal : feedbackTotal;
		if (targetTotal === 0) {
			return;
		}
		didAutoHighlight.current = true;
		if (highlightOnLoad === 'tool-error') {
			goToNextToolError();
		} else {
			goToNextFeedback();
		}
	}, [
		contentReady,
		targetId,
		highlightOnLoad,
		toolErrorTotal,
		feedbackTotal,
		goToNextToolError,
		goToNextFeedback,
		highlightTarget,
	]);

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({
		containerRef,
		sidePanelRef,
		defaultWidthRatio: 0.5,
		shouldCollapseSidebar: false,
	});
	const { data: session } = useSession();
	const isOwner = session?.user?.id === chatReplayQuery.data?.chatOwnerId;
	const title = chatReplayQuery.data?.title ?? 'Chat replay';
	const updatedAt = chatReplayQuery.data?.updatedAt;

	return (
		<div className='w-full h-full min-h-0 flex flex-col p-4 bg-background'>
			<div className='flex items-center justify-between'>
				<div className='flex items-center gap-3 md:p-4 min-w-0'>
					<Button size='sm' variant='ghost' onClick={onBack}>
						<ArrowLeft className='size-4' />
						Back
					</Button>
					<div className='flex min-w-0 flex-col'>
						<div className='flex items-center gap-3'>
							<h2 className='truncate text-foreground font-semibold text-xl leading-none'>{title}</h2>
							{chatReplayQuery.data && <ReplayContextWindowRing chatId={chatId} />}
						</div>
						<div className='flex items-center gap-2'>
							<span className='text-muted-foreground text-xs font-semibold'>
								{updatedAt != null ? formatDate(new Date(updatedAt), 'yyyy-MM-dd') : '—'}
							</span>
							{metadataAction}
						</div>
					</div>
				</div>
				<div className='flex items-center gap-2'>
					{chatReplayQuery.data && (
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
				</div>
			</div>

			<SettingsCard
				rootClassName='flex-1 min-h-0'
				className='flex-1 min-h-0 overflow-hidden bg-background border p-0'
			>
				{chatReplayQuery.isLoading ? (
					<div className='flex-1 overflow-auto p-4 text-sm text-muted-foreground'>Loading chat…</div>
				) : chatReplayQuery.isError ? (
					<div className='flex-1 overflow-auto p-4 text-sm text-destructive'>Failed to load chat.</div>
				) : chatReplayQuery.data ? (
					<ChatViewProvider expandOnError={true}>
						<ChatIdContext.Provider value={chatId}>
							<ReadonlyAgentMessagesProvider messages={chatReplayQuery.data.messages} chatId={chatId}>
								<SidePanelProvider
									isVisible={sidePanel.isVisible}
									currentStorySlug={sidePanel.currentStorySlug}
									setCurrentStorySlug={sidePanel.setCurrentStorySlug}
									currentStoryTabIndex={sidePanel.currentStoryTabIndex}
									setCurrentStoryTabIndex={sidePanel.setCurrentStoryTabIndex}
									chatId={chatId}
									isReadonlyMode={!isOwner}
									open={sidePanel.open}
									close={sidePanel.close}
								>
									<div ref={containerRef} className='flex h-full min-h-0'>
										<div ref={scrollContainerRef} className='flex-1 overflow-auto p-4'>
											<ChatMessagesReadonly
												messages={chatReplayQuery.data.messages}
												forkMetadata={chatReplayQuery.data.forkMetadata}
												conversationContextRef={stickContextRef}
												feedbackRecommendations={chatReplayQuery.data.feedbackRecommendations}
											/>
										</div>
										{sidePanel.content && (
											<SidePanel
												containerRef={containerRef}
												isAnimating={sidePanel.isAnimating}
												sidePanelRef={sidePanelRef}
												resizeHandleRef={sidePanel.resizeHandleRef}
											>
												{sidePanel.content}
											</SidePanel>
										)}
									</div>
								</SidePanelProvider>
							</ReadonlyAgentMessagesProvider>
						</ChatIdContext.Provider>
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
