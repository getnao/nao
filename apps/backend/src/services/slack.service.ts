import { WebClient } from '@slack/web-api';
import { readUIMessageStream, UIDataTypes, UIMessageChunk } from 'ai';
import { FastifyReply } from 'fastify';

import { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import { getUser } from '../queries/user.queries';
import { UIChat, UIMessage } from '../types/chat';
import { SlackEvent } from '../types/slack';
import {
	activeSlackStreams,
	addButtonStopBlock,
	extractLastTextFromMessage,
	saveSlackUserMessage,
	updateSlackUserMessage,
} from '../utils/slack';
import { agentService } from './agent.service';

export class SlackService {
	private _text: string;
	private _channel: string;
	private _threadTs: string;
	private _threadId: string;
	private _slackUserId: string;
	private _user: User = {} as User;
	private _abortController = new AbortController();
	private _redirectUrl = process.env.REDIRECT_URL || 'http://localhost:3000/';
	private _slackClient: WebClient;
	private _buttonTs: string | undefined;
	private _initialMessageTs: string | undefined;

	constructor(event: SlackEvent) {
		this._text = (event.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
		this._channel = event.channel;
		this._threadTs = event.thread_ts || event.ts;
		this._slackUserId = event.user;
		this._threadId = [this._channel, this._threadTs.replace('.', '')].join('/p');
		this._slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
	}

	public async sendRequestAcknowledgement(reply: FastifyReply): Promise<void> {
		await this._checkUserExists(reply);

		reply.send({ ok: true });
		const initialMessage = await this._slackClient.chat.postMessage({
			channel: this._channel,
			text: '🔄 nao is answering...',
			thread_ts: this._threadTs,
		});
		this._initialMessageTs = initialMessage.ts;
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
		await this.sendRequestAcknowledgement(reply);
		const { chatId, isNew } = await this._saveOrUpdateUserMessage();

		const [chat, chatUserId] = await chatQueries.loadChat(chatId);
		if (!chat) {
			return reply.status(404).send({ error: `Chat with id ${chatId} not found.` });
		}

		const isAuthorized = chatUserId === this._user.id;
		if (!isAuthorized) {
			return reply.status(403).send({ error: `You are not authorized to access this chat.` });
		}

		await this._handleStreamAgent(chat, isNew, chatId);
	}

	private async _handleStreamAgent(chat: UIChat, isNew: boolean, chatId: string): Promise<void> {
		activeSlackStreams.set(this._threadId, this._abortController);

		const stream = this._createAgentStream(chat, isNew);
		await this._postStopButton();

		await this._processStream(stream);
		await this._replaceStopButtonWithLink(chatId);
		activeSlackStreams.delete(this._threadId);
	}

	private _createAgentStream(chat: UIChat, isNew: boolean) {
		const agent = agentService.create({ ...chat, userId: this._user.id }, this._abortController);
		return agent.stream(chat.messages as UIMessage[], { sendNewChatData: !!isNew });
	}

	private async _postStopButton(): Promise<void> {
		const buttonMessage = await this._slackClient.chat.postMessage({
			channel: this._channel,
			text: 'Generating response... ',
			blocks: [addButtonStopBlock()],
			thread_ts: this._threadTs,
		});
		this._buttonTs = buttonMessage.ts;
	}

	private async _processStream(stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>): Promise<void> {
		let lastSentText = '';
		let currentText = '';
		const messageTs = this._initialMessageTs || this._threadTs;

		for await (const uiMessage of readUIMessageStream({ stream })) {
			const text = extractLastTextFromMessage(uiMessage);
			if (!text) continue;

			currentText = text;
			const newContent = text.slice(lastSentText.length);
			if (newContent.includes('\n')) {
				await this._slackClient.chat.update({
					channel: this._channel,
					text: text,
					ts: messageTs,
				});
				lastSentText = text;
			}
		}

		// Send final update if there's remaining content
		if (currentText && currentText !== lastSentText) {
			await this._slackClient.chat.update({
				channel: this._channel,
				text: currentText,
				ts: messageTs,
			});
		}
	}

	private async _replaceStopButtonWithLink(chatId: string): Promise<void> {
		const chatUrl = `${this._redirectUrl}${chatId}`;
		await this._slackClient.chat.update({
			channel: this._channel,
			text: `<${chatUrl}|View full conversation>`,
			ts: this._buttonTs || this._threadTs,
		});
	}

	private async _getSlackUserEmail(userId: string): Promise<string | null> {
		const userProfile = await this._slackClient.users.profile.get({ user: userId });
		return userProfile.profile?.email || null;
	}

	private async _saveOrUpdateUserMessage(): Promise<{ chatId: string; isNew: boolean }> {
		const existingChat = await chatQueries.getChatBySlackThread(this._threadId);

		let chatId: string;
		if (existingChat) {
			await updateSlackUserMessage(this._text, existingChat);
			chatId = existingChat.id;
			return { chatId, isNew: false };
		} else {
			const createdChat = await saveSlackUserMessage(this._text, this._user.id, this._threadId);
			chatId = createdChat.id;
			return { chatId, isNew: true };
		}
	}
}
