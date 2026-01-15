import { createContext, useContext } from 'react';
import type { AgentHelpers } from '@/hooks/useAgent';
import { useMemoObject } from '@/hooks/useMemoObject';

const AgentContext = createContext<AgentHelpers | null>(null);

export const useAgentContext = () => {
	const messages = useContext(AgentContext);
	if (!messages) {
		throw new Error('useChatContext must be used within a ChatContextProvider');
	}
	return messages;
};

export interface Props {
	agent: AgentHelpers;
	children: React.ReactNode;
}

export const AgentProvider = ({ agent, children }: Props) => {
	return <AgentContext.Provider value={useMemoObject(agent)}>{children}</AgentContext.Provider>;
};
