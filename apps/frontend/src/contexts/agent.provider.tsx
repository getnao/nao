import { createContext, useContext } from 'react';
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

export interface Props {
	children: React.ReactNode;
}

export const AgentProvider = ({ children }: Props) => {
	const agent = useAgent();

	useSyncMessages({ agent });
	useStreamEndSound(agent.isRunning);

	return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
};
