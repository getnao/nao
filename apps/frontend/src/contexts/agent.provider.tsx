import { createContext, useContext, useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import type { AgentHelpers } from '@/hooks/use-agent';
import { useAgent, useSyncMessages } from '@/hooks/use-agent';
import { useStreamEndSound } from '@/hooks/use-stream-end-sound';

const AgentContext = createContext<AgentHelpers | null>(null);

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
}

export const AgentProvider = ({ children }: Props) => {
	const agent = useAgent();

	useSyncMessages({ agent });
	useStreamEndSound(agent.isRunning);

	return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
};

export const ReadonlyAgentMessagesProvider = ({
	messages,
	children,
}: {
	messages: UIMessage[];
	children: React.ReactNode;
}) => {
	const value = useMemo<AgentHelpers>(() => {
		const noopPromise = async () => {};
		const noop = () => {};

		const setMessages: AgentHelpers['setMessages'] = () => {};
		const queueOrSendMessage: AgentHelpers['queueOrSendMessage'] = noopPromise;
		const editMessage: AgentHelpers['editMessage'] = noopPromise;
		const submitQueuedMessageNow: AgentHelpers['submitQueuedMessageNow'] = noopPromise;
		const stopAgent: AgentHelpers['stopAgent'] = noopPromise;
		const clearError: AgentHelpers['clearError'] = noop;
		const setSelectedModel: AgentHelpers['setSelectedModel'] = () => {};
		const setMentions: AgentHelpers['setMentions'] = noop;

		return {
			messages,
			setMessages,
			queueOrSendMessage,
			editMessage,
			submitQueuedMessageNow,
			status: 'ready',
			isRunning: false,
			isLoadingMessages: false,
			stopAgent,
			error: undefined,
			clearError,
			selectedModel: null,
			setSelectedModel,
			setMentions,
		};
	}, [messages]);

	return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};
