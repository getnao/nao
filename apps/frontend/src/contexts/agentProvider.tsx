import { createContext, useContext } from 'react';
import type { AgentHelpers } from '@/hooks/useAgent';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'backend/chat';
import { useMemoObject } from '@/hooks/useMemoObject';

export interface Props {
	agent: AgentHelpers;
	children: React.ReactNode;
}

export const ChatContext = createContext<UseChatHelpers<UIMessage> | null>(null);

export const useChatContext = () => {
	const messages = useContext(ChatContext);
	if (!messages) {
		throw new Error('useChatContext must be used within a ChatContextProvider');
	}
	return messages;
};

export const AgentProvider = ({ agent, children }: Props) => {
	return <ChatContext.Provider value={useMemoObject({ ...agent })}>{children}</ChatContext.Provider>;
};
