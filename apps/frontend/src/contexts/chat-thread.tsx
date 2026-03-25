import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface ChatThreadContextValue {
	storyHeaderMessageId: string | undefined;
}

const ChatThreadContext = createContext<ChatThreadContextValue>({
	storyHeaderMessageId: undefined,
});

export const useChatThread = () => useContext(ChatThreadContext);

export const ChatThreadProvider = ({
	storyHeaderMessageId,
	children,
}: {
	storyHeaderMessageId: string | undefined;
	children: ReactNode;
}) => {
	const value = useMemoObject({ storyHeaderMessageId });
	return <ChatThreadContext.Provider value={value}>{children}</ChatThreadContext.Provider>;
};
