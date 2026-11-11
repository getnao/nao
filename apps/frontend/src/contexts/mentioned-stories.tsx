import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { ResolvedStory } from '@/hooks/use-mentioned-stories';
import type { StorySummary } from '@/lib/story.utils';
import { useAgentMessages } from '@/contexts/agent.provider';
import { useOpenMentionedStory, useMentionedStories } from '@/hooks/use-mentioned-stories';
import { collectChatArtifacts } from '@/lib/chat-artifacts';
import { findStories } from '@/lib/story.utils';

type MentionedStories = {
	conversationChatId: string | null;
	conversationStories: StorySummary[];
	stories: ResolvedStory[];
	open: (story: ResolvedStory) => void;
	openConversationStory: (storySlug: string) => void;
};

const NO_MENTIONED_STORIES: MentionedStories = {
	conversationChatId: null,
	conversationStories: [],
	stories: [],
	open: () => {},
	openConversationStory: () => {},
};

const MentionedStoriesContext = createContext<MentionedStories>(NO_MENTIONED_STORIES);

export function MentionedStoriesProvider({
	chatId,
	openInSidePanel,
	children,
}: {
	chatId: string;
	openInSidePanel: (story: { chatId: string; slug: string }) => void;
	children: ReactNode;
}) {
	const messages = useAgentMessages();
	const references = useMemo(() => collectChatArtifacts(messages).mentionedStories, [messages]);
	const conversationStories = useMemo(() => findStories(messages), [messages]);
	const stories = useMentionedStories(chatId, references);
	const open = useOpenMentionedStory(openInSidePanel);
	const openConversationStory = useCallback(
		(storySlug: string) => openInSidePanel({ chatId, slug: storySlug }),
		[chatId, openInSidePanel],
	);
	const value = useMemo(
		() => ({ conversationChatId: chatId, conversationStories, stories, open, openConversationStory }),
		[chatId, conversationStories, stories, open, openConversationStory],
	);
	return <MentionedStoriesContext.Provider value={value}>{children}</MentionedStoriesContext.Provider>;
}

export function useMentionedStoriesContext(): MentionedStories {
	return useContext(MentionedStoriesContext);
}
