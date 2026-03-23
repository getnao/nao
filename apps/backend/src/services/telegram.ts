import { createMemoryState } from '@chat-adapter/state-memory';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { CITATION_TAG_REGEX } from '@nao/shared';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { Card, CardElement, Chat, Message, SentMessage, Thread } from 'chat';

import { generateChartImage } from '../components/generate-chart';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { TelegramConfig } from '../queries/project-telegram-config.queries';
import { get as getUser, getByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import {
	createLiveToolCall,
	createPlainTextBlock,
	createSummaryToolCalls,
	createTelegramCompletionCard,
	createTelegramStopButtonCard,
	EXCLUDED_TOOLS,
} from '../utils/messaging-provider';
import { agentService, ModelSelection } from './agent';
import { posthog, PostHogEvent } from './posthog';

const UPDATE_INTERVAL_MS = 200;

class TelegramService {
	private _bot: Chat | null = null;
	private _projectId: string = '';
	private _redirectUrl: string = '';
	private _botToken: string = '';
	private _modelSelection: ModelSelection | undefined = undefined;
	private _lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }> = new Map();
	private _userByTelegramId: Map<string, string> = new Map();

	constructor() {}

	public getWebhooks(config: TelegramConfig) {
		if (this._configChanged(config)) {
			this._initialize(config);
		}
		return this._bot?.webhooks;
	}

	private _configChanged(config: TelegramConfig): boolean {
		return (
			this._botToken !== config.botToken ||
			this._projectId !== config.projectId ||
			this._redirectUrl !== config.redirectUrl ||
			this._modelSelection?.provider !== config.modelSelection?.provider ||
			this._modelSelection?.modelId !== config.modelSelection?.modelId
		);
	}

	private _initialize(config: TelegramConfig): void {
		this._projectId = config.projectId;
		this._redirectUrl = config.redirectUrl;
		this._botToken = config.botToken;
		this._modelSelection = config.modelSelection;

		this._bot = new Chat({
			userName: 'nao',
			adapters: {
				telegram: createTelegramAdapter({
					botToken: config.botToken,
					mode: 'webhook',
				}),
			},
			state: createMemoryState(),
		});

		this._bot.onNewMention(async (thread, message) => {
			if (message.text.startsWith('/login')) {
				await this._handleLoginCommand(thread, message);
				return;
			}
			await this._handleWorkFlow(thread, message);
		});

		this._bot.onNewMessage(/.*/, async (thread, message) => {
			if (message.text.startsWith('/login')) {
				await this._handleLoginCommand(thread, message);
				return;
			}
			await this._handleWorkFlow(thread, message);
		});

		this._bot.onAction('stop_generation', async (event) => {
			const existingChat = await chatQueries.getChatByTelegramThread(event.thread?.id || '');
			if (existingChat) {
				agentService.get(existingChat.id)?.stop();
			}
		});

		this._bot.onAction('feedback_positive', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread?.id || '');
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
			const completion = this._lastCompletionCard.get(event.thread?.id || '');
			if (completion) {
				await completion.card.edit(createTelegramCompletionCard(completion.chatUrl, 'up'));
			}
		});

		this._bot.onAction('feedback_negative', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread?.id || '');
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'down' });
			const completion = this._lastCompletionCard.get(event.thread?.id || '');
			if (completion) {
				await completion.card.edit(createTelegramCompletionCard(completion.chatUrl, 'down'));
			}
		});
	}

	private async _handleWorkFlow(thread: Thread, userMessage: Message): Promise<void> {
		userMessage.text = userMessage.text.replace(/(?:<at>[^<]*<\/at>|@\S+)\s*/g, '').trim();

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

		try {
			await this._validateUserAccess(ctx);
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			await this._saveOrUpdateUserMessage(ctx);

			const [chat] = await chatQueries.loadChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx);
		} catch (error) {
			if (!ctx.convMessage) {
				return;
			}
			const errorMessage = `❌ An error occurred while processing your message. ${error instanceof Error ? error.message : 'Unknown error'}.`;
			ctx.blocks = [createPlainTextBlock(errorMessage)];
			await this._safeEdit(ctx.convMessage, Card({ children: ctx.blocks }));
		}
	}

	private async _validateUserAccess(ctx: ConversationContext): Promise<void> {
		await this._getUser(ctx);
		await this._checkUserBelongsToProject(ctx);
	}

	private async _handleLoginCommand(thread: Thread, message: Message): Promise<void> {
		const telegramId = this._getTelegramId(message);
		if (!telegramId) {
			await thread.post('❌ Could not retrieve your Telegram identity.');
			return;
		}

		const code = message.text.replace(/^\/login\s+/, '').trim();
		if (!code) {
			await thread.post('❌ Invalid code. Usage: `/login <your-code>`');
			return;
		}

		const user = await getByMessagingProviderCode(code);
		if (!user) {
			await thread.post('❌ Invalid linking code. Check your code in the project settings.');
			return;
		}

		this._userByTelegramId.set(telegramId, user.email);
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getTelegramId(message: Message): string | null {
		const raw = message.raw as { from?: { id?: number } };
		const id = raw?.from?.id;
		return id ? String(id) : null;
	}

	private async _getUser(ctx: ConversationContext): Promise<void> {
		const telegramId = this._getTelegramId(ctx.userMessage);
		if (!telegramId) {
			throw new Error('Could not retrieve user identity from Telegram');
		}

		const email = this._userByTelegramId.get(telegramId);
		if (!email) {
			await ctx.thread.post(
				'👋 Welcome! Send `/login <your-code>` to link your account. Find your code in project settings.',
			);
			throw new Error('User not linked');
		}
		const user = await getUser({ email });

		if (!user) {
			this._userByTelegramId.delete(telegramId);
			await ctx.thread.post(`❌ No account found for ${email}. Send \`/login\` again with the correct code.`);
			throw new Error('User not found');
		}
		ctx.user = user;
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

		const existingChat = await chatQueries.getChatByTelegramThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				source: 'telegram',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
		} else {
			const title = createChatTitle({ text });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: ctx.user!.id, projectId: this._projectId, telegramThreadId: ctx.thread.id },
				{ text, source: 'telegram' },
			);
			ctx.chatId = createdChat.id;
			ctx.isNewChat = true;
		}
	}

	private async _handleStreamAgent(chat: UIChat, ctx: ConversationContext): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx);
		const stopCard = await ctx.thread.post(createTelegramStopButtonCard());
		await this._readStreamAndUpdateMessage(stream, ctx);

		await stopCard.delete();
		await this._lastCompletionCard.get(ctx.thread.id)?.card.delete();
		const chatUrl = new URL(ctx.chatId, this._redirectUrl).toString();
		const card = await ctx.thread.post(createTelegramCompletionCard(chatUrl));
		this._lastCompletionCard.set(ctx.thread.id, { card, chatUrl });

		posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
			project_id: this._projectId,
			chat_id: ctx.chatId,
			model_id: ctx.modelId,
			is_new_chat: ctx.isNewChat,
			source: 'telegram',
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
		return agent.stream(chat.messages, { provider: 'telegram', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
	): Promise<StreamState & { lastMessage: UIMessage | null }> {
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
			lastMessage = uiMessage;
		}

		await this._sendFinalText(ctx);
		return { ...state, lastMessage };
	}

	private async _safeEdit(message: SentMessage, card: CardElement): Promise<void> {
		try {
			await message.edit(card);
		} catch (error) {
			if (error instanceof Error && error.message.includes("can't parse entities")) {
				console.warn('Telegram markdown parse error (skipped update):', error.message);
			} else if (error instanceof Error && error.message.includes('message is not modified')) {
				console.warn('Telegram edit skipped (content identical)');
			} else {
				throw error;
			}
		}
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
		if (ctx.convMessage) {
			await this._safeEdit(ctx.convMessage, Card({ children: ctx.blocks }));
		}
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
			state.renderedChartIds.add(part.toolCallId);
			ctx.textBlockIndex = -1;

			await ctx.thread.post({
				markdown: '',
				files: [{ data: png, filename: 'chart.png' }],
			});

			if (ctx.convMessage) {
				await this._safeEdit(ctx.convMessage, Card({ children: ctx.blocks }));
			}
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
			if (ctx.convMessage) {
				await this._safeEdit(ctx.convMessage, Card({ children: ctx.blocks }));
			}
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
		if (ctx.convMessage) {
			await this._safeEdit(ctx.convMessage, Card({ children: ctx.blocks }));
		}
	}

	private _updateTextBlock(text: string, ctx: ConversationContext): void {
		const block = createPlainTextBlock(text.replace(CITATION_TAG_REGEX, ''));
		if (ctx.textBlockIndex === -1) {
			ctx.textBlockIndex = ctx.blocks.length;
			ctx.blocks.push(block);
		} else {
			ctx.blocks[ctx.textBlockIndex] = block;
		}
	}

	private async _getLastAssistantMessageId(threadId: string): Promise<string | null> {
		const chat = await chatQueries.getChatByTelegramThread(threadId);
		if (!chat) {
			return null;
		}
		return chatQueries.getLastAssistantMessageId(chat.id);
	}
}

export const telegramService = new TelegramService();
