import * as chatQueries from '../queries/chat.queries';
import { UIMessage } from '../types/chat';

const updateSlackUserMessage = async (text: string, existingChat: { id: string; title: string }) => {
	const userMessage = createTextMessage(text, 'user');
	await chatQueries.upsertMessage(userMessage, { chatId: existingChat.id });
};

const saveSlackUserMessage = async (text: string, userId: string, slackThreadId?: string) => {
	const userMessage = createTextMessage(text, 'user');

	const createdChat = await chatQueries.createChat({ title: text.slice(0, 64), userId, slackThreadId }, userMessage);
	return createdChat;
};

const createTextMessage = (text: string, role: 'system' | 'user' | 'assistant'): UIMessage => {
	const message: UIMessage = {
		id: crypto.randomUUID(),
		role,
		parts: [{ type: 'text', text }],
	};
	return message;
};

const saveSlackAgentResponse = async (chatId: string, responseText: string) => {
	const assistantMessage = createTextMessage(responseText, 'assistant');
	await chatQueries.upsertMessage(assistantMessage, { chatId });
};

export { saveSlackAgentResponse, saveSlackUserMessage, updateSlackUserMessage };
