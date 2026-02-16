import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<SetChatInputCallbackProvider>
			<AgentProvider>
				<Outlet />
			</AgentProvider>
		</SetChatInputCallbackProvider>
	);
}
