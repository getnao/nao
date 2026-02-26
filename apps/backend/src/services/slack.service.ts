import { KnownBlock } from '@slack/types';
import { WebClient } from '@slack/web-api';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { FastifyReply } from 'fastify';

import { generateChartImage } from '../components/generate-chart';
import { User } from '../db/abstractSchema';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { SlackConfig } from '../queries/project-slack-config.queries';
import { get } from '../queries/user.queries';
import { UIChat } from '../types/chat';
import { UIMessage, UIMessagePart } from '../types/chat';
import { SlackEvent } from '../types/slack';
import { createChatTitle } from '../utils/ai';
import { addButtonStopBlock, createImageBlock, createTextBlock } from '../utils/slack';
import { agentService } from './agent.service';

type StreamState = {
	messageTs: string;
	renderedChartIds: Set<string>;
	sqlOutputs: Map<string, Record<string, unknown>[]>;
	lastUpdateAt: number;
};

export class SlackService {
	private _text: string;
	private _channel: string;
	private _threadTs: string;
	private _threadId: string;
	private _slackUserId: string;
	private _user: User = {} as User;
	private _redirectUrl: string;
	private _slackClient: WebClient;
	private _buttonTs: string | undefined;
	private _initialMessageTs: string | undefined;
	private _chatId: string = '';
	private _projectId: string;
	private _currentConv: { blocks: KnownBlock[] } = { blocks: [] };
	private _textBlockIndex: number = -1;

	constructor(event: SlackEvent, slackConfig: SlackConfig) {
		this._text = (event.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
		this._channel = event.channel;
		this._threadTs = event.thread_ts || event.ts;
		this._slackUserId = event.user;
		this._threadId = [this._channel, this._threadTs.replace('.', '')].join('/p');
		this._projectId = slackConfig.projectId;
		this._redirectUrl = slackConfig.redirectUrl;
		this._slackClient = new WebClient(slackConfig.botToken);
		this._currentConv = { blocks: [] };
		this._textBlockIndex = -1;
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

	public async handleWorkFlow(reply: FastifyReply): Promise<void> {
		await this.sendInitialMessage();
		await this._saveOrUpdateUserMessage();

		const [chat, chatUserId] = await chatQueries.loadChat(this._chatId);
		if (!chat) {
			return reply.status(404).send({ error: `Chat with id ${this._chatId} not found.` });
		}

		const isAuthorized = chatUserId === this._user.id;
		if (!isAuthorized) {
			return reply.status(403).send({ error: `You are not authorized to access this chat.` });
		}

		await this._handleStreamAgent(chat, this._chatId);
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

	private async _saveOrUpdateUserMessage(): Promise<void> {
		const existingChat = await chatQueries.getChatBySlackThread(this._threadId);

		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text: this._text }],
				chatId: existingChat.id,
			});
			this._chatId = existingChat.id;
		} else {
			const title = createChatTitle({ text: this._text });
			const [createdChat] = await chatQueries.createChat(
				{
					title,
					userId: this._user.id,
					projectId: this._projectId,
					slackThreadId: this._threadId,
				},
				{
					text: this._text,
				},
			);
			this._chatId = createdChat.id;
		}
	}

	private async _handleStreamAgent(chat: UIChat, chatId: string): Promise<void> {
		const stream = await this._createAgentStream(chat);
		await this._postStopButton();

		await this._readStreamAndUpdateSlackMessage(stream);
		await this._replaceStopButtonWithLink(chatId);
	}

	private async _createAgentStream(chat: UIChat) {
		const agent = await agentService.create({ ...chat, userId: this._user.id, projectId: this._projectId });
		return agent.stream(chat.messages);
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

	private async _replaceStopButtonWithLink(chatId: string): Promise<void> {
		const chatUrl = new URL(`${chatId}`, `${this._redirectUrl}`).toString();
		await this._slackClient.chat.update({
			channel: this._channel,
			text: `<${chatUrl}|View full conversation>`,
			ts: this._buttonTs || this._threadTs,
		});
	}

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
	): Promise<void> {
		const state: StreamState = {
			messageTs: this._initialMessageTs || this._threadTs,
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
		};

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			switch (part.type) {
				case 'text':
					await this._handleTextPart(part, state);
					break;
				case 'tool-execute_sql':
					this._handleSqlPart(part, state);
					break;
				case 'tool-display_chart':
					await this._handleChartPart(part, state);
					break;
			}
		}

		await this._sendFinalText(state);
	}

	private async _handleTextPart(part: Extract<UIMessagePart, { type: 'text' }>, state: StreamState): Promise<void> {
		this._updateTextBlock(part.text);
		if (Date.now() - state.lastUpdateAt < 500 || !part.text) {
			return;
		}
		await this._slackClient.chat.update({
			channel: this._channel,
			blocks: this._currentConv.blocks,
			ts: state.messageTs,
		});
		state.lastUpdateAt = Date.now();
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: 'tool-execute_sql' }>, state: StreamState): void {
		if (part.state !== 'output-available') {
			return;
		}
		if (part.output.id && part.output.data) {
			state.sqlOutputs.set(part.output.id, part.output.data);
		}
	}

	private async _handleChartPart(
		part: Extract<UIMessagePart, { type: 'tool-display_chart' }>,
		state: StreamState,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedChartIds.has(part.toolCallId)) {
			return;
		}
		const data = state.sqlOutputs.get(part.input.query_id);
		if (!data) {
			return;
		}
		try {
			const png = generateChartImage({ config: part.input, data });
			const chartId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			state.renderedChartIds.add(part.toolCallId);
			await this._postChartImageBlock(chartId);
		} catch (error) {
			console.error('Error generating chart image:', error);
		}
	}

	private async _sendFinalText(state: StreamState): Promise<void> {
		if (this._textBlockIndex === -1) {
			return;
		}
		await this._slackClient.chat.update({
			channel: this._channel,
			blocks: this._currentConv.blocks,
			ts: state.messageTs,
		});
	}

	private _updateTextBlock(text: string): void {
		const block = createTextBlock(text);
		if (this._textBlockIndex === -1) {
			this._textBlockIndex = this._currentConv.blocks.length;
			this._currentConv.blocks.push(block);
		} else {
			this._currentConv.blocks[this._textBlockIndex] = block;
		}
	}

	private async _postChartImageBlock(chartId: string): Promise<void> {
		const imageUrl = new URL(`c/${this._chatId}/${chartId}.png`, this._redirectUrl).toString();
		const messageTs = this._initialMessageTs || this._threadTs;
		this._textBlockIndex = -1;
		this._currentConv.blocks.push(createImageBlock(imageUrl));
		await this._slackClient.chat.update({
			channel: this._channel,
			blocks: this._currentConv.blocks,
			ts: messageTs,
		});
	}

	private async _getSlackUserEmail(userId: string): Promise<string | null> {
		const userProfile = await this._slackClient.users.profile.get({ user: userId });
		return userProfile.profile?.email || null;
	}
}
