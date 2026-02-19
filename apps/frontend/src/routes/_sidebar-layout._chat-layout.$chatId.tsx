import { createFileRoute } from '@tanstack/react-router';
import { useRef } from 'react';
import { ChatInput } from '@/components/chat-input';
import { ChatMessages } from '@/components/chat-messages';
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

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);

	const sidePanel = useSidePanel({ containerRef, sidePanelRef });

	return (
		<SidePanelProvider value={sidePanel}>
			<div className='flex-1 flex min-w-0 bg-panel' ref={containerRef}>
				<div className='flex flex-col h-full flex-1 min-w-72 overflow-hidden justify-center'>
					{isLoadingMessages ? (
						<div className='flex flex-1 items-center justify-center'>
							<Spinner />
						</div>
					) : (
						<ChatMessages />
					)}

					<ChatInput />
				</div>

				{sidePanel.isVisible && sidePanel.content && (
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
