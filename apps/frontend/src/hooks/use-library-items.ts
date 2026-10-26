import { useMemo } from 'react';
import type { Chat } from '@/queries/use-chat-query';
import type { LibraryItem } from '@/lib/library';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useChatQuery } from '@/queries/use-chat-query';
import { areChatArtifactsEqual, collectChatArtifacts } from '@/lib/chat-artifacts';
import { buildChatArtifactItems } from '@/lib/library';
import { buildMockLibraryItems } from '@/lib/library-mock-data';

const mockLibraryItems = buildMockLibraryItems();

export function useLibraryItems(chatId: string | undefined): LibraryItem[] {
	const artifacts = useAgentMessagesSelector(collectChatArtifacts, areChatArtifactsEqual);
	const chatTitle = useChatQuery({ chatId, select: selectChatTitle }).data;

	return useMemo(
		() => [...buildChatArtifactItems(artifacts, chatTitle), ...mockLibraryItems],
		[artifacts, chatTitle],
	);
}

function selectChatTitle(chat: Chat): string {
	return chat.title;
}
