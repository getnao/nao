import { createContext, useContext } from 'react';
import type { AgentHelpers } from '@/hooks/useAgent';
import { useMemoObject } from '@/hooks/useMemoObject';

const AgentContext = createContext<AgentHelpers | null>(null);

export const useAgentContext = () => {
	const agent = useContext(AgentContext);
	if (!agent) {
		throw new Error('useChatContext must be used within a ChatContextProvider');
	}
	return agent;
};

export interface Props {
	agent: AgentHelpers;
	children: React.ReactNode;
}

export const AgentProvider = ({ agent, children }: Props) => {
	return <AgentContext.Provider value={useMemoObject(agent)}>{children}</AgentContext.Provider>;
};
