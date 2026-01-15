import { Outlet } from '@tanstack/react-router';
import { ChatInput } from './chat-input';
import { useAgent, useSyncMessages } from '@/hooks/useAgent';
import { AgentProvider } from '@/contexts/agentProvider';

export function ChatView() {
	const agent = useAgent();

	useSyncMessages({ agent });

	const handleSubmit = (text: string) => {
		if (agent.isRunning) {
			return;
		}
		agent.sendMessage({ text });
	};

	return (
		<AgentProvider agent={agent}>
			<div className='flex flex-1 flex-col bg-slate-100 min-w-0'>
				<Outlet />

				<ChatInput
					onSubmit={handleSubmit}
					onStop={agent.stopAgent}
					isLoading={agent.isRunning}
					disabled={!agent.isReadyForNewMessages}
				/>
			</div>
		</AgentProvider>
	);
}
