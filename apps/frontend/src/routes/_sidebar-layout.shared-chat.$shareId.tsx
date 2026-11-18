import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { HighlightBubble } from '@/components/highlight-bubble';
import { SharedChatAskBar } from '@/components/shared-chat-ask-bar';
import { SharedChatButton } from '@/components/shared-chat-button';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { useSidePanel } from '@/hooks/use-side-panel';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';
import { requestAskAboutSelection } from '@/stores/ask-bar';

export const Route = createFileRoute('/_sidebar-layout/shared-chat/$shareId')({
	component: SharedChatPage,
});

function SharedChatPage() {
	const { shareId } = Route.useParams();
	const { data: session } = useSession();
	const navigate = useNavigate();

	const queryClient = useQueryClient();
	const chatQuery = useQuery(trpc.sharedChat.getSharedChat.queryOptions({ shareId }));
	const isViewer = chatQuery.data?.userRole === 'viewer';
	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: (data) => {
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				navigate({ to: '/$chatId', params: { chatId: data.chatId } });
			},
		}),
	);

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({ containerRef, sidePanelRef });
	const shareSource = useMemo(() => ({ type: 'chat' as const, shareId }), [shareId]);

	const sharedChatData = chatQuery.data;
	const isOwner = session?.user?.id === sharedChatData?.share.userId;
	useTrackViewDuration({ assetType: 'chat', chatId: sharedChatData?.share.chatId, enabled: !isOwner });

	if (chatQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (!chatQuery.data) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<p className='text-sm text-muted-foreground'>Chat not found.</p>
			</div>
		);
	}

	const { share, chat } = chatQuery.data;

	return (
		<ReadonlyAgentMessagesProvider messages={chat.messages} chatId={share.chatId}>
			<SidePanelProvider
				isVisible={sidePanel.isVisible}
				currentStorySlug={sidePanel.currentStorySlug}
				setCurrentStorySlug={sidePanel.setCurrentStorySlug}
				currentStoryTabIndex={sidePanel.currentStoryTabIndex}
				setCurrentStoryTabIndex={sidePanel.setCurrentStoryTabIndex}
				chatId={share.chatId}
				shareSource={shareSource}
				isReadonlyMode={!isOwner}
				open={sidePanel.open}
				close={sidePanel.close}
			>
				<div className='flex flex-col flex-1 min-w-0 bg-background' ref={containerRef}>
					<header className='flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6'>
						<h1 className='text-base font-medium truncate'>{share.title}</h1>
						<span className='text-sm text-muted-foreground shrink-0'>by {share.authorName}</span>
						{isOwner && (
							<SharedChatButton
								shareId={shareId}
								label='Open chat'
								onClick={() => navigate({ to: '/$chatId', params: { chatId: share.chatId } })}
							/>
						)}
						{!isOwner && !isViewer && (
							<SharedChatButton
								shareId={shareId}
								label='Continue chat'
								isPending={forkMutation.isPending}
								onClick={() => forkMutation.mutate({ source: shareSource })}
							/>
						)}
					</header>

					<SelectionProvider key={shareId}>
						{!isViewer && <HighlightBubble onAsk={requestAskAboutSelection} />}
						<div className='flex flex-1 min-h-0 min-w-0'>
							<div className='relative flex-1 min-w-0'>
								<ChatMessagesReadonly
									className='h-full'
									contentClassName={isViewer ? undefined : 'pb-28'}
									messages={chat.messages}
									forkMetadata={chat.forkMetadata}
								/>
								{!isViewer && <SharedChatAskBar shareId={shareId} />}
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
					</SelectionProvider>
				</div>
			</SidePanelProvider>
		</ReadonlyAgentMessagesProvider>
	);
}
