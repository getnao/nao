import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import { ConversationFeedbackGuard } from '@/components/conversation-feedback-guard';
import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { StoryBeforeAgentSendProvider } from '@/contexts/story-before-agent-send';
import { useChatId } from '@/hooks/use-chat-id';
import { useCloudSetupState } from '@/hooks/use-cloud-setup-state';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { useChatQuery } from '@/queries/use-chat-query';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	const exampleSearch = useRouterState({ select: (state) => state.location.search.example === true });
	const isCloud = useIsCloud();
	const chatId = useChatId();
	const chat = useChatQuery({ chatId });
	const { limbo, resolving } = useCloudSetupState();
	const isExampleChat = chat.data?.projectId === SYSTEM_EXAMPLE_PROJECT_ID;
	const openExampleHome = (limbo || resolving) && !chatId;
	const mode = chat.data?.isOnboarding
		? 'onboarding'
		: isCloud && (exampleSearch || isExampleChat || openExampleHome)
			? 'example'
			: 'default';

	return (
		<SetChatInputCallbackProvider>
			<StoryBeforeAgentSendProvider>
				<AgentProvider mode={mode}>
					{chatId && <ConversationFeedbackGuard chatId={chatId} />}
					<Outlet />
				</AgentProvider>
			</StoryBeforeAgentSendProvider>
		</SetChatInputCallbackProvider>
	);
}
