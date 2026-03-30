import { createContext, useContext } from 'react';
import { useParams } from '@tanstack/react-router';

export const ChatIdContext = createContext<string | undefined>(undefined);

export const useChatId = () => {
	const contextChatId = useContext(ChatIdContext);
	const urlChatId = useParams({ strict: false, select: (params) => params.chatId });
	return contextChatId ?? urlChatId;
};
