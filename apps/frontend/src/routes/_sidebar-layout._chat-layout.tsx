import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';

import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { StoryBeforeAgentSendProvider } from '@/contexts/story-before-agent-send';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	const isExampleMode = useRouterState({ select: (state) => state.location.search.example === true });

	return (
		<SetChatInputCallbackProvider>
			<StoryBeforeAgentSendProvider>
				<AgentProvider mode={isExampleMode ? 'example' : 'default'}>
					<Outlet />
				</AgentProvider>
			</StoryBeforeAgentSendProvider>
		</SetChatInputCallbackProvider>
	);
}
