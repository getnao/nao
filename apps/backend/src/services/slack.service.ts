import { WebClient } from '@slack/web-api';
import { readUIMessageStream, UIDataTypes, UIMessageChunk } from 'ai';
import { FastifyReply } from 'fastify';

import { User } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { SlackConfig } from '../queries/project-slack-config.queries';
import { get } from '../queries/user.queries';
import { UIChat } from '../types/chat';
import { UIMessage } from '../types/chat';
import { SlackEvent } from '../types/slack';
import { extractLastTextFromMessage } from '../utils/chat';
import { addButtonStopBlock } from '../utils/slack';
import { agentService } from './agent.service';

export class SlackService {
	private _text: string;
	private _channel: string;
	private _threadTs: string;
	private _threadId: string;
	private _slackUserId: string;
	private _user: User = {} as User;
	private _abortController = new AbortController();
	private _redirectUrl: string;
	private _slackClient: WebClient;
	private _buttonTs: string | undefined;
	private _initialMessageTs: string | undefined;
	private _projectId: string;

	constructor(event: SlackEvent, slackConfig: SlackConfig) {
		this._text = (event.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
		this._channel = event.channel;
		this._threadTs = event.thread_ts || event.ts;
		this._slackUserId = event.user;
		this._threadId = [this._channel, this._threadTs.replace('.', '')].join('/p');
		this._projectId = slackConfig.projectId;
		this._redirectUrl = slackConfig.redirectUrl;
		this._slackClient = new WebClient(slackConfig.botToken);
	}

	public async sendInitialMessage(): Promise<void> {
		await this._validateUserAccess();

		const initialMessage = await this._slackClient.chat.postMessage({
			channel: this._channel,
			text: '🔄 nao is answering...',
			thread_ts: this._threadTs,
		});
		this._initialMessageTs = initialMessage.ts;
	}

	private async _validateUserAccess(): Promise<void> {
		this._user = await this._getUser();
		await this._checkUserBelongsToProject();
	}

	private async _getUser(): Promise<User> {
		const userEmail = await this._getSlackUserEmail(this._slackUserId);
		if (!userEmail) {
			throw new Error('Could not retrieve user email from Slack');
		}

		const user = await get({ email: userEmail });
		if (!user) {
			const fullMessage = `❌ No user found. Create an account with ${userEmail} on ${this._redirectUrl} to sign up.`;
			await this._slackClient.chat.postMessage({
				channel: this._channel,
				text: fullMessage,
				thread_ts: this._threadTs,
			});
			throw new Error('User not found');
		}
		return user;
	}

	private async _checkUserBelongsToProject(): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._projectId, this._user.id);
		if (role !== 'admin' && role !== 'user') {
			const fullMessage = `❌ You don't have permission to use nao in this project. Please contact an administrator.`;
			await this._slackClient.chat.postMessage({
				channel: this._channel,
				text: fullMessage,
				thread_ts: this._threadTs,
			});
			throw new Error('User does not have permission to access this project');
		}
	}

	public async handleWorkFlow(reply: FastifyReply): Promise<void> {
		await this.sendInitialMessage();
		const chatId = await this._saveOrUpdateUserMessage();

		const [chat, chatUserId] = await chatQueries.loadChat(chatId);
		if (!chat) {
			return reply.status(404).send({ error: `Chat with id ${chatId} not found.` });
		}

		const isAuthorized = chatUserId === this._user.id;
		if (!isAuthorized) {
			return reply.status(403).send({ error: `You are not authorized to access this chat.` });
		}

		await this._handleStreamAgent(chat, chatId);
	}

	private async _handleStreamAgent(chat: UIChat, chatId: string): Promise<void> {
		const stream = await this._createAgentStream(chat);
		await this._postStopButton();

		await this._readStreamAndUpdateSlackMessage(stream);
		await this._replaceStopButtonWithLink(chatId);
	}

	private async _createAgentStream(chat: UIChat) {
		const agent = await agentService.create(
			{ ...chat, userId: this._user.id, projectId: this._projectId },
			this._abortController,
		);
		return agent.stream(chat.messages, { sendNewChatData: false });
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

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>,
	): Promise<void> {
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

	private async _saveOrUpdateUserMessage(): Promise<string> {
		const existingChat = await chatQueries.getChatBySlackThread(this._threadId);

		const userMessage: UIMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			parts: [{ type: 'text', text: this._text }],
		};
		if (existingChat) {
			await chatQueries.upsertMessage(userMessage, { chatId: existingChat.id });
			return existingChat.id;
		} else {
			const createdChat = await chatQueries.createChat(
				{
					title: this._text.slice(0, 64),
					userId: this._user.id,
					projectId: this._projectId,
					slackThreadId: this._threadId,
				},
				userMessage,
			);
			return createdChat.id;
		}
	}
}
