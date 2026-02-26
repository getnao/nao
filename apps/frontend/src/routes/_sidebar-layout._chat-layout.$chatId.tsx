import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { StoryOpenButton } from '@/components/story-open-button';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { SidePanel } from '@/components/side-panel/side-panel';
import { Spinner } from '@/components/ui/spinner';
import { useAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/hooks/use-side-panel';
import { SidePanelProvider } from '@/contexts/side-panel';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/$chatId')({
	component: RouteComponent,
});

export function RouteComponent() {
	const { isLoadingMessages } = useAgentContext();
	const router = useRouter();
	const { chatId } = Route.useParams();

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);

	const sidePanel = useSidePanel({ containerRef, sidePanelRef });

	useEffect(() => {
		const openStoryId = router.state.location.state.openStoryId;
		if (!openStoryId || isLoadingMessages) {
			return;
		}

		sidePanel.open(<StoryViewer chatId={chatId} storyId={openStoryId} />, openStoryId);

		const timer = setTimeout(() => {
			router.history.replace(router.state.location.href, {
				...router.state.location.state,
				openStoryId: undefined,
			});
		});
		return () => clearTimeout(timer);
	}, [isLoadingMessages]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStoryId={sidePanel.currentStoryId}
			open={sidePanel.open}
		>
			<div className='flex-1 flex min-w-0 bg-panel' ref={containerRef}>
				<div className='flex flex-col h-full flex-1 min-w-72 overflow-hidden justify-center relative'>
					<div className='absolute top-3 right-3 z-10'>
						<StoryOpenButton />
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
		</SidePanelProvider>
	);
}
