import { useMemo } from 'react';
import { useAgentContext } from '@/contexts/agent.provider';
import { findStories } from '@/lib/story.utils';

export const useStoryViewerAgentState = () => {
	const { messages, status } = useAgentContext();

	const allStories = useMemo(() => findStories(messages), [messages]);
	const isAgentRunning = status === 'streaming' || status === 'submitted';

	return {
		allStories,
		isAgentRunning,
	};
};
