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

const extractLastTextFromMessage = (message: { parts: { type: string; text?: string }[] }): string => {
	for (let i = message.parts.length - 1; i >= 0; i--) {
		const part = message.parts[i];
		if (part.type === 'text' && part.text) {
			return part.text;
		}
	}
	return '';
};

const addButtonStopBlock = () => {
	return {
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: 'Stop Generation',
					emoji: true,
				},
				style: 'primary',
				action_id: 'stop_generation',
			},
		],
	};
};

const activeSlackStreams = new Map<string, AbortController>();

export {
	activeSlackStreams,
	addButtonStopBlock,
	extractLastTextFromMessage,
	saveSlackUserMessage,
	updateSlackUserMessage,
};
