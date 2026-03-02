import { createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { WebClient } from '@slack/web-api';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Card, CardChild, Chat, Message, SentMessage, Thread } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import { User } from '../db/abstractSchema';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { SlackConfig } from '../queries/project-slack-config.queries';
import { get as getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { createChatTitle } from '../utils/ai';
import {
	createCompletionCard,
	createFeedbackModal,
	createImageBlock,
	createLiveToolCall,
	createStopButtonCard,
	createSummaryToolCalls,
	createTextBlock,
	FEEDBACK_MODAL_CALLBACK_ID,
	type ToolCallEntry,
} from '../utils/slack';
import { agentService } from './agent.service';

const UPDATE_INTERVAL_MS = 500;

type ConversationContext = {
	thread: Thread;
	userMessage: Message;
	user: User | null;
	chatId: string;
	assistantMessage: UIMessage | null;
	convMessage: SentMessage | null;
	blocks: CardChild[];
	textBlockIndex: number;
};

type StreamState = {
	renderedChartIds: Set<string>;
	sqlOutputs: Map<string, Record<string, unknown>[]>;
	lastUpdateAt: number;
	toolGroup: Map<string, ToolCallEntry>;
	toolGroupBlockIndex: number;
};

class SlackService {
	private _bot: Chat | null = null;
	private _slackClient: WebClient | null = null;
	private _projectId: string = '';
	private _redirectUrl: string = '';
	private _initialized: boolean = false;
	private _ctx: ConversationContext = {
		thread: null!,
		userMessage: null!,
		user: null,
		chatId: '',
		assistantMessage: null!,
		convMessage: null,
		blocks: [],
		textBlockIndex: -1,
	};

	constructor() {}

	public getWebhooks(slackConfig: SlackConfig) {
		this._initialize(slackConfig);
		return this._bot?.webhooks;
	}

	private _initialize(slackConfig: SlackConfig): void {
		if (this._initialized) {
			return;
		}
		this._initialized = true;

		this._projectId = slackConfig.projectId;
		this._redirectUrl = slackConfig.redirectUrl;
		this._slackClient = new WebClient(slackConfig.botToken);

		this._bot = new Chat({
			userName: 'nao-chat',
			adapters: {
				slack: createSlackAdapter({
					botToken: slackConfig.botToken,
					signingSecret: slackConfig.signingSecret,
				}),
			},
			state: createMemoryState(),
		});

		this._bot.onNewMention(async (thread, message) => {
			await thread.subscribe();
			await this.handleWorkFlow(thread, message);
		});

		this._bot.onSubscribedMessage(async (thread, message) => {
			await this.handleWorkFlow(thread, message);
		});

		this._bot.onAction('stop_generation', async (event) => {
			const existingChat = await chatQueries.getChatBySlackThread(event.thread.id);
			if (existingChat) {
				agentService.get(existingChat.id)?.stop();
			}
		});

		this._bot.onAction('feedback_positive', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread.id);
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
		});

		this._bot.onAction('feedback_negative', async (event) => {
			await event.openModal({
				...createFeedbackModal(),
				privateMetadata: event.thread.id,
			});
		});

		this._bot.onModalSubmit(FEEDBACK_MODAL_CALLBACK_ID, async (event) => {
			const threadId = event.privateMetadata;
			if (!threadId) {
				return;
			}
			const messageId = await this._getLastAssistantMessageId(threadId);
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({
				messageId,
				vote: 'down',
				explanation: event.values['explanation'] || undefined,
			});
			return { action: 'close' };
		});
	}

	private async handleWorkFlow(thread: Thread, userMessage: Message): Promise<void> {
		userMessage.text = userMessage.text.replace(/(?:<@|@)([A-Z0-9]+)(?:\|[^>]+)?>?\s*/g, '').trim();

		this._ctx = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			blocks: [],
			textBlockIndex: -1,
			assistantMessage: null,
		};

		await this._validateUserAccess();

		try {
			this._ctx.convMessage = await this._ctx.thread.post('✨ nao is answering...');
			await this._saveOrUpdateUserMessage();

			const [chat] = await chatQueries.loadChat(this._ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat);
		} catch (error) {
			console.error('Slack workflow error:', error);
			const errorMessage = '❌ An error occurred while processing your message. Please try again later.';
			if (this._ctx.convMessage) {
				await this._ctx.convMessage.edit(errorMessage);
			} else {
				await this._ctx.thread.post(errorMessage);
			}
		}
	}

	private async _validateUserAccess(): Promise<void> {
		await this._getUser();
		await this._checkUserBelongsToProject();
	}

	private async _getUser(): Promise<void> {
		const slackUserId = this._ctx.userMessage.author.userId;
		const email = await this._getSlackUserEmail(slackUserId);

		if (!email) {
			throw new Error('Could not retrieve user email from Slack');
		}

		const user = await getUser({ email });
		if (!user) {
			await this._ctx.thread.post(
				`❌ No user found. Create an account with \`${email}\` on ${this._redirectUrl} to sign up.`,
			);
			throw new Error('User not found');
		}
		this._ctx.user = user;
	}

	private async _getSlackUserEmail(userId: string): Promise<string | null> {
		const userProfile = await this._slackClient?.users.profile.get({ user: userId });
		return userProfile?.profile?.email || null;
	}

	private async _checkUserBelongsToProject(): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._projectId, this._ctx.user!.id);
		if (role !== 'admin' && role !== 'user') {
			await this._ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(): Promise<void> {
		const text = this._ctx.userMessage.text;

		const existingChat = await chatQueries.getChatBySlackThread(this._ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
			});
			this._ctx.chatId = existingChat.id;
		} else {
			const title = createChatTitle({ text });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: this._ctx.user!.id, projectId: this._projectId, slackThreadId: this._ctx.thread.id },
				{ text },
			);
			this._ctx.chatId = createdChat.id;
		}
	}

	private async _handleStreamAgent(chat: UIChat): Promise<void> {
		const stream = await this._createAgentStream(chat);
		const stopCard = await this._ctx.thread.post(createStopButtonCard());

		await this._readStreamAndUpdateSlackMessage(stream);

		await stopCard.delete();
		const chatUrl = new URL(this._ctx.chatId, this._redirectUrl).toString();
		await this._ctx.thread.post(createCompletionCard(chatUrl));
	}

	private async _createAgentStream(chat: UIChat): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create({ ...chat, userId: this._ctx.user!.id, projectId: this._projectId });
		return agent.stream(chat.messages);
	}

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
	): Promise<void> {
		const state: StreamState = {
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		let lastMessage: UIMessage | null = null;

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			if (part.type === 'text') {
				this._flushToolGroup(state);
				await this._handleTextPart(part, state);
			} else if (part.type === 'tool-execute_sql') {
				this._flushToolGroup(state);
				this._handleSqlPart(part, state);
			} else if (part.type === 'tool-display_chart') {
				this._flushToolGroup(state);
				await this._handleChartPart(part, state);
			} else if (part.type.startsWith('tool-') && part.type !== 'tool-suggest_follow_ups') {
				await this._handleCollapsibleToolPart(part as Extract<UIMessagePart, { toolCallId: string }>, state);
			}
			lastMessage = uiMessage;
		}

		this._ctx.assistantMessage = lastMessage;
		await this._sendFinalText();
	}

	private async _handleTextPart(part: Extract<UIMessagePart, { type: 'text' }>, state: StreamState): Promise<void> {
		this._updateTextBlock(part.text);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !part.text) {
			return;
		}
		await this._ctx.convMessage?.edit(Card({ children: this._ctx.blocks }));
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
			const imageUrl = new URL(
				`c/${this._ctx.chatId}/${chartId}.png`,
				'https://c54e-86-229-150-239.ngrok-free.app',
			).toString();

			this._ctx.textBlockIndex = -1;
			this._ctx.blocks.push(createImageBlock(imageUrl));
			await this._ctx.convMessage?.edit(Card({ children: this._ctx.blocks }));
		} catch (error) {
			console.error('Error generating chart image:', error);
		}
	}

	private async _handleCollapsibleToolPart(
		part: Extract<UIMessagePart, { toolCallId: string }>,
		state: StreamState,
	): Promise<void> {
		if (part.state === 'input-streaming') {
			return;
		}

		const entry: ToolCallEntry = {
			type: part.type,
			input: ('input' in part ? part.input : {}) as Record<string, string>,
			toolCallId: part.toolCallId,
		};

		state.toolGroup.set(part.toolCallId, entry);

		if (state.toolGroupBlockIndex === -1) {
			state.toolGroupBlockIndex = this._ctx.blocks.length;
			this._ctx.blocks.push(createLiveToolCall(state.toolGroup));
		} else {
			this._ctx.blocks[state.toolGroupBlockIndex] = createLiveToolCall(state.toolGroup);
		}

		if (Date.now() - state.lastUpdateAt >= UPDATE_INTERVAL_MS) {
			await this._ctx.convMessage?.edit(Card({ children: this._ctx.blocks }));
			state.lastUpdateAt = Date.now();
		}
	}

	private _flushToolGroup(state: StreamState): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		this._ctx.blocks[state.toolGroupBlockIndex] = createSummaryToolCalls(state.toolGroup);
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
	}

	private async _sendFinalText(): Promise<void> {
		if (this._ctx.textBlockIndex === -1) {
			return;
		}
		await this._ctx.convMessage?.edit(Card({ children: this._ctx.blocks }));
	}

	private _updateTextBlock(text: string): void {
		const block = createTextBlock(text);
		if (this._ctx.textBlockIndex === -1) {
			this._ctx.textBlockIndex = this._ctx.blocks.length;
			this._ctx.blocks.push(block);
		} else {
			this._ctx.blocks[this._ctx.textBlockIndex] = block;
		}
	}

	private async _getLastAssistantMessageId(threadId: string): Promise<string | null> {
		const chat = await chatQueries.getChatBySlackThread(threadId);
		if (!chat) {
			return null;
		}
		return chatQueries.getLastAssistantMessageId(chat.id);
	}
}

export const slackService = new SlackService();
