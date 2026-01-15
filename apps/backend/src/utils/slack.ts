import { WebClient } from '@slack/web-api';

import * as chatQueries from '../queries/chatQueries';
import { getUser } from '../queries/userQueries';
import { UIChat, UIMessage } from '../types/chat';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const redirectUrl = 'http://localhost:3000/';

const createTextMessage = (text: string, role: 'system' | 'user' | 'assistant'): UIMessage => {
	const message: UIMessage = {
		id: crypto.randomUUID(),
		role,
		parts: [{ type: 'text', text }],
	};
	return message;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const saveSlackUserMessage = async (text: string, userId: string) => {
	const userMessage = createTextMessage(text, 'user');

	const createdChat = await chatQueries.createChat({ title: text.slice(0, 64), userId }, userMessage);
	return createdChat;
};

const saveSlackAgentResponse = async (createdChat: UIChat, responseText: string) => {
	const assistantMessage = createTextMessage(responseText, 'assistant');
	await chatQueries.upsertMessage(createdChat.id, assistantMessage);
};

const sendFirstResponseAcknowledgement = async (channel: string, threadTs: string, reply: any) => {
	reply.send({ ok: true });
	await slackClient.chat.postMessage({
		channel: channel,
		text: '🔄 Nao is analyzing your request... This may take a moment.',
		thread_ts: threadTs,
	});
};

const getSlackUserEmail = async (userId: string): Promise<string | null> => {
	const userProfile = await slackClient.users.profile.get({ user: userId });
	return userProfile.profile?.email || null;
};

const getSlackUser = async (body: any, channel: string, threadTs: string, reply: any) => {
	reply.send({ ok: true });
	const userEmail = await getSlackUserEmail(body.event?.user);

	const user = await getUser({ email: userEmail! });
	if (!user) {
		const fullMessage = `❌ On nao-chat, create a user account with ${userEmail} to use this bot. \n\n Go to ${redirectUrl} to sign up.`;
		await slackClient.chat.postMessage({
			channel: channel,
			text: fullMessage,
			thread_ts: threadTs,
		});
		throw new Error('User not found');
	}
	return user;
};

export {
	getSlackUser,
	redirectUrl,
	saveSlackAgentResponse,
	saveSlackUserMessage,
	sendFirstResponseAcknowledgement,
	slackClient,
};
