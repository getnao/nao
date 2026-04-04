import { createContext, useContext, useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import type { AgentHelpers } from '@/hooks/use-agent';
import { useAgent, useSyncMessages } from '@/hooks/use-agent';
import { useStreamEndSound } from '@/hooks/use-stream-end-sound';

export const AgentContext = createContext<AgentHelpers | null>(null);

export const useAgentContext = () => {
	const agent = useContext(AgentContext);
	if (!agent) {
		throw new Error('useAgentContext must be used within a AgentProvider');
	}
	return agent;
};

export const useOptionalAgentContext = () => useContext(AgentContext);

export interface Props {
	children: React.ReactNode;
	disableNavigation?: boolean;
}

export const AgentProvider = ({ children, disableNavigation }: Props) => {
	const agent = useAgent({ disableNavigation });

	useSyncMessages({ agent });
	useStreamEndSound(agent.isRunning);

	return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
};

export const ReadonlyAgentMessagesProvider = ({
	messages,
	chatId,
	children,
}: {
	messages: UIMessage[];
	chatId?: string;
	children: React.ReactNode;
}) => {
	const value = useMemo<AgentHelpers>(
		() => ({
			chatId,
			messages,
			setMessages: noop,
			queueOrSendMessage: noopPromise,
			editMessage: noopPromise,
			submitQueuedMessageNow: noopPromise,
			status: 'ready',
			isRunning: false,
			isLoadingMessages: false,
			stopAgent: noopPromise,
			error: undefined,
			clearError: noop,
			selectedModel: null,
			setSelectedModel: noop,
			setMentions: noop,
		}),
		[chatId, messages],
	);

	return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

const noop = () => {};
const noopPromise = async () => {};
