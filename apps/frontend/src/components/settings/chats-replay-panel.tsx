import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { formatDate } from 'date-fns';
import type { StickToBottomContext } from 'use-stick-to-bottom';

import type { ReplayCrumb } from '@/components/settings/replay-breadcrumb';
import type { ReplayHighlight } from '@/components/settings/usage-route-search';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Spinner } from '@/components/ui/spinner';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { InlineStatusBar } from '@/components/settings/chats-replay-inline-status-bar';
import { CopyReplayLinkButton, ReplayHeader, ReplayIconButton } from '@/components/settings/replay-header';
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
	origin: ReplayCrumb;
	highlightOnLoad?: ReplayHighlight;
	targetId?: string;
};

export function ChatsReplayPanel({ chatId, origin, highlightOnLoad, targetId }: ChatsReplayPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const chatReplayQuery = useQuery(
		trpc.project.getChatReplay.queryOptions(
			{ chatId },
			{
				enabled: !!chatId,
				refetchOnWindowFocus: 'always',
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
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

	return (
		<div className='flex flex-col h-full flex-1 min-w-0 overflow-hidden bg-background'>
			<ReplayHeader crumbs={[origin, { label: title }]}>
				{chatReplayQuery.data && (
					<>
						<InlineStatusBar
							className='mr-2'
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
						{updatedAt != null && (
							<span className='px-2 text-xs text-muted-foreground'>
								{formatDate(new Date(updatedAt), 'yyyy-MM-dd')}
							</span>
						)}
						<ReplayContextWindowRing chatId={chatId} />
						<ReplayIconButton label='Analytics' onClick={() => setIsAnalyticsOpen(true)}>
							<Info className='size-3.5' />
						</ReplayIconButton>
						<CopyReplayLinkButton />
					</>
				)}
			</ReplayHeader>

			<div className='flex flex-col flex-1 min-h-0 overflow-hidden'>
				{chatReplayQuery.isLoading ? (
					<div className='flex flex-1 items-center justify-center'>
						<Spinner />
					</div>
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
									isReplay={true}
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
			</div>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='chat'
				chatId={chatId}
			/>
		</div>
	);
}
