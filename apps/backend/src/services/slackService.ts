import { FastifyReply } from 'fastify';

import { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chatQueries';
import { getUser } from '../queries/userQueries';
import { agentGenerateResponse } from '../services/agentService';
import { SlackRequest } from '../types/slack';
import {
	getSlackUserEmail,
	saveSlackAgentResponse,
	saveSlackUserMessage,
	slackClient,
	updateSlackUserMessage,
} from '../utils/slack';

const redirectUrl = process.env.REDIRECT_URL;

export class SlackService {
	private body: SlackRequest;
	private channel: string;
	private threadTs: string;

	constructor(body: SlackRequest, channel: string, threadTs: string) {
		this.body = body;
		this.channel = channel;
		this.threadTs = threadTs;
	}

	async getUser(reply: FastifyReply): Promise<User> {
		reply.send({ ok: true });
		const userId = this.body.event?.user;
		if (!userId) {
			throw new Error('User ID is missing in the Slack event');
		}

		const userEmail = await getSlackUserEmail(userId);
		if (!userEmail) {
			throw new Error('Could not retrieve user email from Slack');
		}

		const user = await getUser({ email: userEmail });
		if (!user) {
			const fullMessage = `❌ No user found. Create an user account with ${userEmail} on ${redirectUrl} to sign up.`;
			await slackClient.chat.postMessage({
				channel: this.channel,
				text: fullMessage,
				thread_ts: this.threadTs,
			});
			throw new Error('User not found');
		}
		return user;
	}

	async sendRequestAcknowledgement(reply: FastifyReply): Promise<void> {
		reply.send({ ok: true });
		await slackClient.chat.postMessage({
			channel: this.channel,
			text: '🔄 nao is answering... please wait a few seconds.',
			thread_ts: this.threadTs,
		});
	}

	async handleWorkFlow(user: User, text: string): Promise<void> {
		const chatId = await this.saveOrUpdateUserMessage(text, user);

		const responseText = await agentGenerateResponse(text);

		await saveSlackAgentResponse(chatId, responseText);

		const chatUrl = `${redirectUrl}${chatId}`;
		const fullMessage = `${responseText}\n\nIf you want to see more, go to ${chatUrl}`;

		await slackClient.chat.postMessage({
			channel: this.channel,
			text: fullMessage,
			thread_ts: this.threadTs,
		});
	}

	private async saveOrUpdateUserMessage(text: string, user: User): Promise<string> {
		const existingChat = await chatQueries.getChatBySlackThread(this.threadTs);

		let chatId: string;
		if (existingChat) {
			await updateSlackUserMessage(text, existingChat);
			chatId = existingChat.id;
		} else {
			const createdChat = await saveSlackUserMessage(text, user.id, this.threadTs);
			chatId = createdChat.id;
		}
		return chatId;
	}
}
