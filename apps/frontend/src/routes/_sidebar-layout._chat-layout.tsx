import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import type { Chat } from '@/queries/use-chat-query';
import { ConversationFeedbackGuard } from '@/components/chat-header-feedback';
import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { StoryBeforeAgentSendProvider } from '@/contexts/story-before-agent-send';
import { useChatId } from '@/hooks/use-chat-id';
import { useCloudSetupState } from '@/hooks/use-cloud-setup-state';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { useChatQuery } from '@/queries/use-chat-query';
import { getShownStoryFiltersRequestBody } from '@/stores/shown-story-filters';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	const exampleSearch = useRouterState({ select: (state) => state.location.search.example === true });
	const isCloud = useIsCloud();
	const chatId = useChatId();
	const chat = useChatQuery({ chatId, select: selectChatMode });
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
				<AgentProvider mode={mode} getRequestBody={getShownStoryFiltersRequestBody}>
					{chatId && <ConversationFeedbackGuard chatId={chatId} />}
					<Outlet />
				</AgentProvider>
			</StoryBeforeAgentSendProvider>
		</SetChatInputCallbackProvider>
	);
}

function selectChatMode(chat: Chat) {
	return { projectId: chat.projectId, isOnboarding: chat.isOnboarding };
}
