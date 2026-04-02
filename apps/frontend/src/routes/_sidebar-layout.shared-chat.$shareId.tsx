import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useRef } from 'react';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { HighlightBubble } from '@/components/highlight-bubble';
import { SelectionChatPanel } from '@/components/selection-chat-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { useSidePanel } from '@/hooks/use-side-panel';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';

export const Route = createFileRoute('/_sidebar-layout/shared-chat/$shareId')({
	component: SharedChatPage,
});

function SharedChatPage() {
	const { shareId } = Route.useParams();
	const { data: session } = useSession();
	const navigate = useNavigate();

	const chatQuery = useQuery(trpc.sharedChat.getSharedChat.queryOptions({ shareId }));
	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: (data) => {
				navigate({ to: '/$chatId', params: { chatId: data.chatId } });
			},
		}),
	);

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const contentAreaRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({ containerRef, sidePanelRef });

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
	const isOwner = session?.user?.id === share.userId;

	return (
		<ReadonlyAgentMessagesProvider messages={chat.messages} chatId={share.chatId}>
			<SidePanelProvider
				isVisible={sidePanel.isVisible}
				currentStoryId={sidePanel.currentStoryId}
				chatId={share.chatId}
				isReadonlyMode={!isOwner}
				open={sidePanel.open}
				close={sidePanel.close}
			>
				<div className='flex flex-col flex-1 min-w-0 bg-panel' ref={containerRef}>
					<header className='flex items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4 shrink-0 bg-background'>
						<h1 className='text-base font-medium truncate'>{share.title}</h1>
						<span className='text-sm text-muted-foreground shrink-0'>by {share.authorName}</span>
						{isOwner ? (
							<Button variant='outline' size='sm' className='ml-auto gap-1.5 shrink-0' asChild>
								<Link to='/$chatId' params={{ chatId: share.chatId }}>
									<MessageSquare className='size-3.5' />
									<span>Open chat</span>
								</Link>
							</Button>
						) : (
							<Button
								variant='outline'
								size='sm'
								className='ml-auto gap-1.5 shrink-0'
								onClick={() => forkMutation.mutate({ shareId, type: 'chat' })}
								disabled={forkMutation.isPending}
							>
								{forkMutation.isPending ? (
									<Spinner className='size-3.5' />
								) : (
									<MessageSquare className='size-3.5' />
								)}
								<span>Continue chat</span>
							</Button>
						)}
					</header>

					<SelectionProvider key={shareId} persistenceConfig={{ shareId, contentType: 'chat' }}>
						<HighlightBubble shareId={shareId} contentType='chat' />
						<SelectionChatPanel contentAreaRef={contentAreaRef} />
						<div className='flex flex-1 min-h-0 min-w-0'>
							<div ref={contentAreaRef} className='flex-1 min-w-0'>
								<ChatMessagesReadonly
									className='h-full'
									messages={chat.messages}
									forkMetadata={chat.forkMetadata}
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
					</SelectionProvider>
				</div>
			</SidePanelProvider>
		</ReadonlyAgentMessagesProvider>
	);
}
