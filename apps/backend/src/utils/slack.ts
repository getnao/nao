import { WebClient } from '@slack/web-api';

import * as chatQueries from '../queries/chatQueries';
import { UIMessage } from '../types/chat';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const updateSlackUserMessage = async (text: string, existingChat: { id: string; title: string }) => {
	const userMessage = createTextMessage(text, 'user');
	await chatQueries.upsertMessage(existingChat.id, userMessage);
};

const saveSlackUserMessage = async (text: string, userId: string, slackThreadTs?: string) => {
	const userMessage = createTextMessage(text, 'user');

	const createdChat = await chatQueries.createChat({ title: text.slice(0, 64), userId, slackThreadTs }, userMessage);
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

const getSlackUserEmail = async (userId: string): Promise<string | null> => {
	const userProfile = await slackClient.users.profile.get({ user: userId });
	return userProfile.profile?.email || null;
};

const saveSlackAgentResponse = async (chatId: string, responseText: string) => {
	const assistantMessage = createTextMessage(responseText, 'assistant');
	await chatQueries.upsertMessage(chatId, assistantMessage);
};

export { getSlackUserEmail, saveSlackAgentResponse, saveSlackUserMessage, slackClient, updateSlackUserMessage };
