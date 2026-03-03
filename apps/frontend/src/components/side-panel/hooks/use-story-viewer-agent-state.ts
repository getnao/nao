import { useMemo } from 'react';
import { useAgentContext } from '@/contexts/agent.provider';
import { findStories, findStoryDraft } from '@/lib/story.utils';

export const useStoryViewerAgentState = (storyId: string) => {
	const { messages, status } = useAgentContext();

	const allStories = useMemo(() => findStories(messages), [messages]);
	const draftStory = useMemo(() => findStoryDraft(messages, storyId), [messages, storyId]);
	const isAgentRunning = status === 'streaming' || status === 'submitted';

	return {
		allStories,
		draftStory,
		isAgentRunning,
	};
};
