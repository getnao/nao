import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

interface ChatViewContextValue {
	expandOnError: boolean;
}

const ChatViewContext = createContext<ChatViewContextValue>({
	expandOnError: false,
});

export const useChatView = () => useContext(ChatViewContext);

export const ChatViewProvider = ({ expandOnError, children }: { expandOnError: boolean; children: ReactNode }) => {
	const value = useMemoObject({ expandOnError });
	return <ChatViewContext.Provider value={value}>{children}</ChatViewContext.Provider>;
};
