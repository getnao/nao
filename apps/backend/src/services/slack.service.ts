import { WebClient } from '@slack/web-api';
import { FastifyReply } from 'fastify';

import { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import { getUser } from '../queries/user.queries';
import { SlackRequest } from '../types/slack';
import { saveSlackAgentResponse, saveSlackUserMessage, updateSlackUserMessage } from '../utils/slack';
import { agentService } from './agent.service';

export class SlackService {
	private _text: string;
	private _channel: string;
	private _threadTs: string;
	private _threadId: string;
	private _slackUserId: string;
	private _user: User = {} as User;
	private _abortController = new AbortController();
	private _redirectUrl = process.env.REDIRECT_URL || '';
	private _slackClient: WebClient;

	constructor(body: SlackRequest) {
		if (!body.event?.text || !body.event?.channel || !body.event?.ts || !body.event?.user) {
			throw new Error('Invalid request: missing text, channel, thread timestamp, or user ID');
		}
		this._text = (body.event?.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
		this._channel = body.event.channel;
		this._threadTs = body.event.thread_ts || body.event.ts;
		this._slackUserId = body.event.user;
		this._threadId = [this._channel, this._threadTs.replace('.', '')].join('/p');

		if (!process.env.SLACK_BOT_TOKEN) {
			throw new Error('SLACK_BOT_TOKEN is not defined in environment variables');
		}
		this._slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
	}

	public async sendRequestAcknowledgement(reply: FastifyReply): Promise<void> {
		await this._checkUserExists(reply);

		reply.send({ ok: true });
		await this._slackClient.chat.postMessage({
			channel: this._channel,
			text: '🔄 nao is answering... please wait a few seconds.',
			thread_ts: this._threadTs,
		});
	}

	private async _checkUserExists(reply: FastifyReply): Promise<void> {
		this._user = await this._getUser(reply);
	}

	private async _getUser(reply: FastifyReply): Promise<User> {
		reply.send({ ok: true });

		const userEmail = await this._getSlackUserEmail(this._slackUserId);
		if (!userEmail) {
			throw new Error('Could not retrieve user email from Slack');
		}

		const user = await getUser({ email: userEmail });
		if (!user) {
			const fullMessage = `❌ No user found. Create an user account with ${userEmail} on ${this._redirectUrl} to sign up.`;
			await this._slackClient.chat.postMessage({
				channel: this._channel,
				text: fullMessage,
				thread_ts: this._threadTs,
			});
			throw new Error('User not found');
		}
		return user;
	}

	public async handleWorkFlow(reply: FastifyReply): Promise<void> {
		const chatId = await this._saveOrUpdateUserMessage();

		const [chat, chatUserId] = await chatQueries.loadChat(chatId);
		if (!chat) {
			return reply.status(404).send({ error: `Chat with id ${chatId} not found.` });
		}

		const isAuthorized = chatUserId === this._user.id;
		if (!isAuthorized) {
			return reply.status(403).send({ error: `You are not authorized to access this chat.` });
		}

		const agent = agentService.create({ ...chat, userId: this._user.id }, this._abortController);
		const agentResponse = await agent.generate(this._text);

		await saveSlackAgentResponse(chatId, agentResponse);

		const chatUrl = `${this._redirectUrl}${chatId}`;
		const fullMessage = `${agentResponse}\n\nIf you want to see more, go to ${chatUrl}`;

		await this._slackClient.chat.postMessage({
			channel: this._channel,
			text: fullMessage,
			thread_ts: this._threadTs,
		});
	}

	private async _getSlackUserEmail(userId: string): Promise<string | null> {
		const userProfile = await this._slackClient.users.profile.get({ user: userId });
		return userProfile.profile?.email || null;
	}

	private async _saveOrUpdateUserMessage(): Promise<string> {
		const existingChat = await chatQueries.getChatBySlackThread(this._threadId);

		let chatId: string;
		if (existingChat) {
			await updateSlackUserMessage(this._text, existingChat);
			chatId = existingChat.id;
		} else {
			const createdChat = await saveSlackUserMessage(this._text, this._user.id, this._threadId);
			chatId = createdChat.id;
		}
		return chatId;
	}
}
