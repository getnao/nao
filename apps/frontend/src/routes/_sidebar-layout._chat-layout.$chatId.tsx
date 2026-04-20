import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { GitFork, Globe, Share } from 'lucide-react';
import type { ForkMetadata } from '@nao/backend/chat';
import { StoryOpenButton } from '@/components/story-open-button';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { SidePanel } from '@/components/side-panel/side-panel';
import { MobileHeader } from '@/components/mobile-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/hooks/use-side-panel';
import { SidePanelProvider } from '@/contexts/side-panel';
import { EditableChatTitle } from '@/components/editable-chat-title';
import { useChatQuery } from '@/queries/use-chat-query';
import { ShareChatDialog } from '@/components/share-dialog.chat';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/$chatId')({
	component: RouteComponent,
});

export function RouteComponent() {
	const { isLoadingMessages, isRunning } = useAgentContext();
	const router = useRouter();
	const { chatId } = Route.useParams();
	const chat = useChatQuery({ chatId });
	const title = chat.data?.title;
	const shareQuery = useQuery(trpc.sharedChat.getShareOptionsByChatId.queryOptions({ chatId: chatId ?? '' }));
	const isShared = !!shareQuery.data?.shareId;

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);

	const sidePanel = useSidePanel({ containerRef, sidePanelRef });
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

	const isSelectionFork =
		chat.data?.forkMetadata?.type === 'chat_selection' || chat.data?.forkMetadata?.type === 'story_selection';
	const headerCitation = buildHeaderCitation(isSelectionFork ? chat.data?.forkMetadata : undefined);

	useEffect(() => {
		const openStorySlug = router.state.location.state.openStorySlug;
		if (!openStorySlug || isLoadingMessages) {
			return;
		}

		sidePanel.open(<StoryViewer chatId={chatId} storySlug={openStorySlug} />, openStorySlug);

		const timer = setTimeout(() => {
			router.history.replace(router.state.location.href, {
				...router.state.location.state,
				openStorySlug: undefined,
			});
		});
		return () => clearTimeout(timer);
	}, [isLoadingMessages]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStorySlug={sidePanel.currentStorySlug}
			chatId={chatId}
			open={sidePanel.open}
			close={sidePanel.close}
		>
			<div className='flex-1 flex min-w-0 bg-panel' ref={containerRef}>
				<div className='flex flex-col h-full flex-1 min-w-0 overflow-hidden justify-center relative'>
					<MobileHeader chatId={chatId} title={title} />

					<div className='group/header absolute flex items-center justify-between top-3 inset-x-4 z-10 max-md:hidden'>
						<div className='min-w-0 max-w-[60%] flex flex-row gap-4'>
							{title && (
								<EditableChatTitle
									chatId={chatId}
									title={title}
									className='text-sm text-muted-foreground'
								/>
							)}
							{chat.data?.forkMetadata && (
								<Badge variant='outline' className='gap-1 text-muted-foreground w-fit'>
									<GitFork />
									<span className='truncate'>
										{chat.data.forkMetadata.type === 'story' ? 'Story' : 'Chat'} thread from{' '}
									</span>
									<span className='text-xs text-foreground'>{chat.data.forkMetadata.authorName}</span>
									{headerCitation && (
										<span className='truncate'>
											{' '}
											— {headerCitation.citation}: &ldquo;{headerCitation.text}&rdquo;
										</span>
									)}
								</Badge>
							)}
						</div>
						<div className='flex items-center gap-2'>
							<StoryOpenButton variant='ghost' />
							<Button
								variant='ghost'
								size='icon-sm'
								onClick={() => setIsShareDialogOpen(true)}
								disabled={isRunning}
								aria-label='Share Chat'
							>
								{!isRunning && isShared ? (
									<Globe className='size-3 text-emerald-600' />
								) : (
									<Share className='size-3' />
								)}
							</Button>
						</div>
					</div>

					<div className='absolute inset-x-0 top-0 z-[5] pointer-events-none max-md:hidden'>
						<div className='h-10 bg-panel' />
						<div className='h-3 bg-gradient-to-b from-panel to-transparent' />
					</div>

					{isLoadingMessages ? (
						<div className='flex flex-1 items-center justify-center'>
							<Spinner />
						</div>
					) : (
						<ChatMessages />
					)}

					<ChatInput />
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
			<ShareChatDialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen} chatId={chatId} />
		</SidePanelProvider>
	);
}

function buildHeaderCitation(meta: ForkMetadata | undefined): { citation: string; text: string } | null {
	if (!meta?.selectionText) {
		return null;
	}
	const text = meta.selectionText.length > 20 ? `${meta.selectionText.slice(0, 20)}\u2026` : meta.selectionText;
	const citation = `@chars ${meta.selectionStart}–${meta.selectionEnd}`;
	return { citation, text };
}
