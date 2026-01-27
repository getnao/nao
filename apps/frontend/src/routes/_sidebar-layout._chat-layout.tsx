import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AgentProvider } from '@/contexts/agent.provider';
import { ChatInput } from '@/components/chat-input';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<AgentProvider>
			<div className='flex flex-col h-full flex-1 bg-panel min-w-0 overflow-hidden justify-center'>
				<Outlet />
				<ChatInput />
			</div>
		</AgentProvider>
	);
}
