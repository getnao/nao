import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AgentProvider } from '@/contexts/agent.provider';
import { ChatInput } from '@/components/chat-input';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { BelowChatInputSlotProvider, BelowChatInputSlot } from '@/contexts/below-chat-input-slot';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<SetChatInputCallbackProvider>
			<AgentProvider>
				<BelowChatInputSlotProvider>
					<div className='flex flex-col h-full flex-1 bg-panel min-w-0 overflow-hidden justify-center'>
						<Outlet />
						<ChatInput />
						<BelowChatInputSlot />
					</div>
				</BelowChatInputSlotProvider>
			</AgentProvider>
		</SetChatInputCallbackProvider>
	);
}
