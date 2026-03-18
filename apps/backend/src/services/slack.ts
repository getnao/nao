import { createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { WebClient } from '@slack/web-api';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Card, Chat, Message, SentMessage, Thread } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import * as chartImageQueries from '../queries/chart-image';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { SlackConfig } from '../queries/project-slack-config.queries';
import { get as getUser } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import {
	createCompletionCard,
	createFeedbackModal,
	createImageBlock,
	createLiveToolCall,
	createStopButtonCard,
	createSummaryToolCalls,
	createTextBlock,
	escapeCsvCell,
	EXCLUDED_TOOLS,
	FEEDBACK_MODAL_CALLBACK_ID,
} from '../utils/messaging-provider';
import { agentService, ModelSelection } from './agent';
import { posthog, PostHogEvent } from './posthog';

const UPDATE_INTERVAL_MS = 200;

class SlackService {
	private _bot: Chat | null = null;
	private _slackClient: WebClient | null = null;
	private _projectId: string = '';
	private _redirectUrl: string = '';
	private _currentBotToken: string = '';
	private _currentSigningSecret: string = '';
	private _modelSelection: ModelSelection | undefined = undefined;
	private _lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }> = new Map();

	constructor() {}

	public getWebhooks(config: SlackConfig) {
		if (this._configChanged(config)) {
			this._initialize(config);
		}
		return this._bot?.webhooks;
	}

	private _configChanged(config: SlackConfig): boolean {
		return (
			this._currentBotToken !== config.botToken ||
			this._currentSigningSecret !== config.signingSecret ||
			this._projectId !== config.projectId ||
			this._redirectUrl !== config.redirectUrl ||
			this._modelSelection?.provider !== config.modelSelection?.provider ||
			this._modelSelection?.modelId !== config.modelSelection?.modelId
		);
	}

	private _initialize(config: SlackConfig): void {
		this._currentBotToken = config.botToken;
		this._currentSigningSecret = config.signingSecret;

		this._projectId = config.projectId;
		this._redirectUrl = config.redirectUrl;
		this._modelSelection = config.modelSelection;
		this._slackClient = new WebClient(config.botToken);

		this._bot = new Chat({
			userName: 'nao-chat',
			adapters: {
				slack: createSlackAdapter({
					botToken: config.botToken,
					signingSecret: config.signingSecret,
				}),
			},
			state: createMemoryState(),
		});

		this._bot.onNewMention(async (thread, message) => {
			await thread.subscribe();
			await this._handleWorkFlow(thread, message);
		});

		this._bot.onSubscribedMessage(async (thread, message) => {
			await this._handleWorkFlow(thread, message);
		});

		this._bot.onAction('stop_generation', async (event) => {
			const existingChat = await chatQueries.getChatBySlackThread(event.thread!.id);
			if (existingChat) {
				agentService.get(existingChat.id)?.stop();
			}
		});

		this._bot.onAction('feedback_positive', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread!.id);
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
			const completion = this._lastCompletionCard.get(event.thread!.id);
			if (completion) {
				await completion.card.edit(createCompletionCard(completion.chatUrl, 'up'));
			}
		});

		this._bot.onAction('feedback_negative', async (event) => {
			await event.openModal({
				...createFeedbackModal(),
				privateMetadata: event.thread!.id,
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

			const chat = await chatQueries.getChatBySlackThread(threadId);
			if (!chat) {
				throw new Error(`Chat for thread ${threadId} not found.`);
			}

			const ownerId = await chatQueries.getOwnerOfChatAndMessage(chat.id, messageId);
			if (!ownerId) {
				throw new Error(`Message with id ${messageId} not found.`);
			}

			const slackUserId = event.user?.userId;
			const slackUser = slackUserId ? await this._getSlackUser(slackUserId) : null;
			const email = slackUser?.profile?.email || null;
			const user = email ? await getUser({ email }) : null;

			if (ownerId !== user?.id) {
				throw new Error(`You are not authorized to provide feedback on this message.`);
			}

			await feedbackQueries.upsertFeedback({
				messageId,
				vote: 'down',
				explanation: event.values['explanation'] || undefined,
			});
			const completion = this._lastCompletionCard.get(threadId);
			if (completion) {
				await completion.card.edit(createCompletionCard(completion.chatUrl, 'down'));
			}
			return { action: 'close' };
		});
	}

	private async _handleWorkFlow(thread: Thread, userMessage: Message): Promise<void> {
		userMessage.text = userMessage.text.replace(/(?:<@|@)([A-Z0-9]+)(?:\|[^>]+)?>?\s*/g, '').trim();

		const ctx: ConversationContext = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			blocks: [],
			textBlockIndex: -1,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		await this._validateUserAccess(ctx);

		try {
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.loadChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			const errorMessage = `❌ An error occurred while processing your message. ${error instanceof Error ? error.message : 'Unknown error'}.`;
			ctx.blocks.push(createTextBlock(errorMessage));
			if (ctx.convMessage) {
				await ctx.convMessage.edit(Card({ children: ctx.blocks }));
			} else {
				await ctx.thread.post(errorMessage);
			}
		}
	}

	private async _validateUserAccess(ctx: ConversationContext): Promise<void> {
		await this._getUser(ctx);
		await this._checkUserBelongsToProject(ctx);
	}

	private async _getUser(ctx: ConversationContext): Promise<void> {
		const slackUserId = ctx.userMessage.author.userId;
		const slackUser = await this._getSlackUser(slackUserId);
		const email = slackUser?.profile?.email || null;

		if (!email) {
			throw new Error('Could not retrieve user email from Slack');
		}

		const user = await getUser({ email });
		if (!user) {
			await ctx.thread.post(
				`❌ No user found. Create an account with \`${email}\` on ${this._redirectUrl} to sign up.`,
			);
			throw new Error('User not found');
		}
		ctx.user = user;
		ctx.timezone = slackUser?.tz || undefined;
	}

	private async _getSlackUser(userId: string) {
		const response = await this._slackClient?.users.info({ user: userId });
		return response?.user || null;
	}

	private async _checkUserBelongsToProject(ctx: ConversationContext): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(this._projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(ctx: ConversationContext): Promise<void> {
		const text = ctx.userMessage.text;

		const existingChat = await chatQueries.getChatBySlackThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				source: 'slack',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
		} else {
			const title = createChatTitle({ text });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: ctx.user!.id, projectId: this._projectId, slackThreadId: ctx.thread.id },
				{ text, source: 'slack' },
			);
			ctx.chatId = createdChat.id;
			ctx.isNewChat = true;
		}
	}

	private async _handleStreamAgent(chat: UIChat, ctx: ConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const stopCard = await ctx.thread.post(createStopButtonCard());

		const state = await this._readStreamAndUpdateSlackMessage(stream, ctx);

		await stopCard.delete();
		await this._uploadLastSqlResultAsCsv(state, ctx);
		await this._lastCompletionCard.get(ctx.thread.id)?.card.delete();
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const card = await ctx.thread.post(createCompletionCard(chatUrl));
		this._lastCompletionCard.set(ctx.thread.id, { card, chatUrl });

		posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
			project_id: this._projectId,
			chat_id: ctx.chatId,
			model_id: ctx.modelId,
			is_new_chat: ctx.isNewChat,
			source: 'slack',
			domain_host: new URL(this._redirectUrl).host,
		});
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: ConversationContext,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create(
			{ ...chat, userId: ctx.user!.id, projectId: this._projectId },
			this._modelSelection,
		);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'slack', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateSlackMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
	): Promise<StreamState> {
		const state: StreamState = {
			renderedChartIds: new Set(),
			sqlOutputs: new Map(),
			lastUpdateAt: Date.now(),
			toolGroup: new Map(),
			toolGroupBlockIndex: -1,
		};

		for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
			const part = uiMessage.parts[uiMessage.parts.length - 1];
			if (!part) {
				continue;
			}
			if (part.type.startsWith('tool-') && !EXCLUDED_TOOLS.includes(part.type)) {
				await this._handleCollapsibleToolPart(
					part as Extract<UIMessagePart, { toolCallId: string }>,
					state,
					ctx,
				);
			}
			if (part.type === 'text') {
				this._flushToolGroup(state, ctx);
				await this._handleTextPart(part, state, ctx);
			} else if (part.type === 'tool-execute_sql') {
				this._handleSqlPart(part, state);
			} else if (part.type === 'tool-display_chart') {
				await this._handleChartPart(part, state, ctx);
			}
		}

		await this._sendFinalText(ctx);
		return state;
	}

	private async _handleTextPart(
		part: Extract<UIMessagePart, { type: 'text' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		this._updateTextBlock(part.text, ctx);
		if (Date.now() - state.lastUpdateAt < UPDATE_INTERVAL_MS || !part.text) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
		state.lastUpdateAt = Date.now();
	}

	private _handleSqlPart(part: Extract<UIMessagePart, { type: 'tool-execute_sql' }>, state: StreamState): void {
		if (part.state !== 'output-available') {
			return;
		}
		if (part.output.id && part.output.data) {
			state.sqlOutputs.set(part.output.id, { name: part.input.name ?? null, rows: part.output.data });
		}
	}

	private async _handleChartPart(
		part: Extract<UIMessagePart, { type: 'tool-display_chart' }>,
		state: StreamState,
		ctx: ConversationContext,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedChartIds.has(part.toolCallId)) {
			return;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return;
		}
		try {
			const png = generateChartImage({ config: part.input, data: sqlOutput.rows });
			const chartId = await chartImageQueries.saveChart(part.toolCallId, png.toString('base64'));
			state.renderedChartIds.add(part.toolCallId);
			const imageUrl = new URL(`c/${ctx.chatId}/${chartId}.png`, this._redirectUrl).toString();

			ctx.textBlockIndex = -1;
			ctx.blocks.push(createImageBlock(imageUrl));
			await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
		} catch (error) {
			console.error('Error generating chart image:', error);
		}
	}

	private async _handleCollapsibleToolPart(
		part: Extract<UIMessagePart, { toolCallId: string }>,
		state: StreamState,
		ctx: ConversationContext,
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
			state.toolGroupBlockIndex = ctx.blocks.length;
			ctx.blocks.push(createLiveToolCall(state.toolGroup));
		} else {
			ctx.blocks[state.toolGroupBlockIndex] = createLiveToolCall(state.toolGroup);
		}

		if (Date.now() - state.lastUpdateAt >= UPDATE_INTERVAL_MS) {
			await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
			state.lastUpdateAt = Date.now();
		}
	}

	private _flushToolGroup(state: StreamState, ctx: ConversationContext): void {
		if (state.toolGroup.size === 0) {
			return;
		}
		ctx.blocks[state.toolGroupBlockIndex] = createSummaryToolCalls(state.toolGroup);
		state.toolGroup = new Map();
		state.toolGroupBlockIndex = -1;
	}

	private async _sendFinalText(ctx: ConversationContext): Promise<void> {
		if (ctx.textBlockIndex === -1) {
			return;
		}
		await ctx.convMessage?.edit(Card({ children: ctx.blocks }));
	}

	private _updateTextBlock(text: string, ctx: ConversationContext): void {
		const block = createTextBlock(text);
		if (ctx.textBlockIndex === -1) {
			ctx.textBlockIndex = ctx.blocks.length;
			ctx.blocks.push(block);
		} else {
			ctx.blocks[ctx.textBlockIndex] = block;
		}
	}

	private async _uploadLastSqlResultAsCsv(state: StreamState, ctx: ConversationContext): Promise<void> {
		if (state.sqlOutputs.size === 0) {
			return;
		}
		const { name, rows } = [...state.sqlOutputs.values()].at(-1)!;
		if (rows.length === 0) {
			return;
		}
		const columns = Object.keys(rows[0]);
		const header = columns.join(',');
		const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(',')).join('\n');
		const csv = `${header}\n${body}`;
		const filename = name ? `${name.toLowerCase().replace(/\s+/g, '_')}.csv` : 'data.csv';

		const [, channelId, threadTs] = ctx.thread.id.split(':');
		await this._slackClient?.files.uploadV2({
			channel_id: channelId,
			thread_ts: threadTs,
			filename,
			content: csv,
		});
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
