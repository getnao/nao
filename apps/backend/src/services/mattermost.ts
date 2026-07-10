import { createMemoryState } from '@chat-adapter/state-memory';
import { CITATION_TAG_REGEX } from '@nao/shared';
import type { LlmSelectedModel } from '@nao/shared/types';
import { InferUIMessageChunk, readUIMessageStream } from 'ai';
import { CardElement, Chat, Message, SentMessage, Thread } from 'chat';
import { createMattermostAdapter } from 'chat-adapter-mattermost';

import { generateChartImage } from '../components/generate-chart';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { listMattermostConfigs, MatterMostConfig } from '../queries/project-mattermost-config.queries';
import { getUser, getUserByMessagingProviderCode } from '../queries/user.queries';
import { UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { ConversationContext, StreamState, ToolCallEntry } from '../types/messaging-provider';
import { createChatTitle } from '../utils/ai';
import {
	EXCLUDED_TOOLS,
	createLiveToolCall,
	createPlainTextBlock,
	createSummaryToolCalls,
	createTelegramCompletionCard,
	formatMessagingError,
} from '../utils/messaging-provider';
import { env } from '../env';
import { logger } from '../utils/logger';
import { agentService } from './agent';
import { posthog, PostHogEvent } from './posthog';

const UPDATE_INTERVAL_MS = 200;

interface ProjectBotState {
	bot: Chat;
	config: MatterMostConfig;
	lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }>;
	userByMattermostId: Map<string, string>;
}

class MatterMostService {
	private _bots: Map<string, ProjectBotState> = new Map();

	constructor() {}

	public async getWebhooks(config: MatterMostConfig) {
		await this._startProject(config);
		const state = this._bots.get(config.projectId);
		return state?.bot.webhooks;
	}

	public async startForAllProjects(): Promise<void> {
		try {
			const configs = await listMattermostConfigs();
			for (const config of configs) {
				try {
					this._startProject(config);
					logger.info(`Mattermost bot started for project ${config.projectId}`, { source: 'system' });
				} catch (error) {
					logger.error(`Failed to start Mattermost bot for project ${config.projectId}: ${String(error)}`, {
						source: 'system',
					});
				}
			}
		} catch (error) {
			logger.error(`Failed to enumerate Mattermost projects: ${String(error)}`, { source: 'system' });
		}
	}

	public async startProject(config: MatterMostConfig): Promise<void> {
		this._startProject(config);
	}

	public async stopProject(projectId: string): Promise<void> {
		this._bots.delete(projectId);
	}

	private async _startProject(config: MatterMostConfig): Promise<void> {
		const existing = this._bots.get(config.projectId);
		if (existing && !this._configChanged(existing.config, config)) {
			return;
		}
		if (existing) {
			this._bots.delete(config.projectId);
		}

		const lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }> = new Map();
		const userByMattermostId: Map<string, string> = new Map();

		const bot = new Chat({
			userName: 'nao',
			adapters: {
				mattermost: createMattermostAdapter({
					baseUrl: config.baseUrl,
					botToken: config.botToken,
				}),
			},
			state: createMemoryState(),
		});

		const projectId = config.projectId;
		const redirectUrl = config.redirectUrl;
		const modelSelection = config.modelSelection;

		bot.onNewMention(async (thread, message) => {
			if (message.text.startsWith('login ')) {
				await this._handleLoginCommand(thread, message, userByMattermostId);
				return;
			}
			await this._handleWorkFlow(
				thread,
				message,
				projectId,
				redirectUrl,
				modelSelection,
				lastCompletionCard,
				userByMattermostId,
			);
		});

		bot.onNewMessage(/.*/, async (thread, message) => {
			if (message.text.startsWith('login ')) {
				await this._handleLoginCommand(thread, message, userByMattermostId);
				return;
			}
			await this._handleWorkFlow(
				thread,
				message,
				projectId,
				redirectUrl,
				modelSelection,
				lastCompletionCard,
				userByMattermostId,
			);
		});

		bot.onAction('stop_generation', async (event) => {
			const existingChat = await chatQueries.getChatByMattermostThread(event.thread?.id || '');
			if (existingChat) {
				agentService.get(existingChat.id)?.stop();
			}
		});

		bot.onAction('feedback_positive', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread?.id || '');
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'up' });
			const completion = lastCompletionCard.get(event.thread?.id || '');
			if (completion) {
				await completion.card.edit(createTelegramCompletionCard(completion.chatUrl, 'up'));
			}
		});

		bot.onAction('feedback_negative', async (event) => {
			const messageId = await this._getLastAssistantMessageId(event.thread?.id || '');
			if (!messageId) {
				return;
			}
			await feedbackQueries.upsertFeedback({ messageId, vote: 'down' });
			const completion = lastCompletionCard.get(event.thread?.id || '');
			if (completion) {
				await completion.card.edit(createTelegramCompletionCard(completion.chatUrl, 'down'));
			}
		});

		await bot.initialize();

		this._bots.set(config.projectId, { bot, config, lastCompletionCard, userByMattermostId });
	}

	private _configChanged(a: MatterMostConfig, b: MatterMostConfig): boolean {
		return (
			a.baseUrl !== b.baseUrl ||
			a.botToken !== b.botToken ||
			a.projectId !== b.projectId ||
			a.redirectUrl !== b.redirectUrl ||
			a.modelSelection?.provider !== b.modelSelection?.provider ||
			a.modelSelection?.modelId !== b.modelSelection?.modelId
		);
	}

	private async _handleWorkFlow(
		thread: Thread,
		userMessage: Message,
		projectId: string,
		redirectUrl: string,
		modelSelection: LlmSelectedModel | undefined,
		lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }>,
		userByMattermostId: Map<string, string>,
	): Promise<void> {
		userMessage.text = userMessage.text.replace(/(?:<at>[^<]*<\/at>|@\S+)\s*/g, '').trim();

		const ctx: ConversationContext = {
			thread,
			userMessage,
			user: null,
			chatId: '',
			convMessage: null,
			blocks: [],
			textBlockIndex: -1,
			textBlockCount: 0,
			isNewChat: false,
			modelId: undefined,
			timezone: undefined,
		};

		try {
			await this._validateUserAccess(ctx, projectId, userByMattermostId);
			ctx.convMessage = await ctx.thread.post('✨ nao is answering...');
			await this._saveOrUpdateUserMessage(ctx, projectId, userByMattermostId);

			const [chat] = await chatQueries.getChat(ctx.chatId);
			if (!chat) {
				throw new Error('Chat not found after saving message');
			}

			await this._handleStreamAgent(chat, ctx, projectId, redirectUrl, modelSelection, lastCompletionCard);
		} catch (error) {
			if (!ctx.convMessage) {
				return;
			}
			const errorMessage = formatMessagingError(error);
			ctx.blocks = [createPlainTextBlock(errorMessage)];
			await this._safeEdit(ctx.convMessage, errorMessage);
		}
	}

	private async _validateUserAccess(
		ctx: ConversationContext,
		projectId: string,
		userByMattermostId: Map<string, string>,
	): Promise<void> {
		await this._getUser(ctx, userByMattermostId);
		await this._checkUserBelongsToProject(ctx, projectId);
	}

	private async _handleLoginCommand(
		thread: Thread,
		message: Message,
		userByMattermostId: Map<string, string>,
	): Promise<void> {
		const mattermostId = this._getMattermostId(message);
		if (!mattermostId) {
			await thread.post('❌ Could not retrieve your Mattermost identity.');
			return;
		}

		const code = message.text.replace(/^login\s+/, '').trim();
		if (!code) {
			await thread.post('❌ Invalid code. Usage: `login <your-code>`');
			return;
		}

		const user = await getUserByMessagingProviderCode(code);
		if (!user) {
			await thread.post('❌ Invalid linking code. Check your code in the project settings.');
			return;
		}

		userByMattermostId.set(mattermostId, user.email.toLowerCase());
		await thread.post(`✅ Linked to ${user.email}. You can now send messages to nao!`);
	}

	private _getMattermostId(message: Message): string | null {
		return message.author.userId || null;
	}

	private async _getUser(ctx: ConversationContext, userByMattermostId: Map<string, string>): Promise<void> {
		const mattermostId = this._getMattermostId(ctx.userMessage);
		if (!mattermostId) {
			throw new Error('Could not retrieve user identity from Mattermost');
		}

		const email = userByMattermostId.get(mattermostId);
		if (!email) {
			await ctx.thread.post(
				'👋 Welcome! Send `login <your-code>` to link your account. Find your code in project settings.',
			);
			throw new Error('User not linked');
		}
		const user = await getUser({ email });

		if (!user) {
			userByMattermostId.delete(mattermostId);
			await ctx.thread.post(`❌ No account found for ${email}. Send \`login\` again with the correct code.`);
			throw new Error('User not found');
		}
		ctx.user = user;
	}

	private async _checkUserBelongsToProject(ctx: ConversationContext, projectId: string): Promise<void> {
		const role = await projectQueries.getUserRoleInProject(projectId, ctx.user!.id);
		if (role !== 'admin' && role !== 'user' && role !== 'context_admin') {
			await ctx.thread.post(
				"❌ You don't have permission to use nao in this project. Please contact an administrator.",
			);
			throw new Error('User does not have permission to access this project');
		}
	}

	private async _saveOrUpdateUserMessage(
		ctx: ConversationContext,
		projectId: string,
		userByMattermostId: Map<string, string>,
	): Promise<void> {
		const text = ctx.userMessage.text;

		const existingChat = await chatQueries.getChatByMattermostThread(ctx.thread.id);
		if (existingChat) {
			await chatQueries.upsertMessage({
				role: 'user',
				parts: [{ type: 'text', text }],
				chatId: existingChat.id,
				source: 'mattermost',
			});
			ctx.chatId = existingChat.id;
			ctx.isNewChat = false;
		} else {
			const title = createChatTitle({ text });
			const [createdChat] = await chatQueries.createChat(
				{ title, userId: ctx.user!.id, projectId, mattermostThreadId: ctx.thread.id },
				{ text, source: 'mattermost' },
			);
			ctx.chatId = createdChat.id;
			ctx.isNewChat = true;
		}
	}

	private async _handleStreamAgent(
		chat: UIChat,
		ctx: ConversationContext,
		projectId: string,
		redirectUrl: string,
		modelSelection: LlmSelectedModel | undefined,
		lastCompletionCard: Map<string, { card: SentMessage; chatUrl: string }>,
	): Promise<void> {
		const stream = await this._createAgentStream(chat, ctx, projectId, modelSelection);
		await this._readStreamAndUpdateMessage(stream, ctx, projectId);

		await lastCompletionCard.get(ctx.thread.id)?.card.delete();
		const chatUrl = new URL(ctx.chatId, redirectUrl).toString();
		const card = await ctx.thread.post(createTelegramCompletionCard(chatUrl));
		lastCompletionCard.set(ctx.thread.id, { card, chatUrl });

		posthog.capture(ctx.user!.id, PostHogEvent.MessageSent, {
			project_id: projectId,
			chat_id: ctx.chatId,
			model_id: ctx.modelId,
			is_new_chat: ctx.isNewChat,
			source: 'mattermost',
			domain_host: new URL(redirectUrl).host,
		});
	}

	private async _createAgentStream(
		chat: UIChat,
		ctx: ConversationContext,
		projectId: string,
		modelSelection: LlmSelectedModel | undefined,
	): Promise<ReadableStream<InferUIMessageChunk<UIMessage>>> {
		const agent = await agentService.create({ ...chat, userId: ctx.user!.id, projectId }, modelSelection);
		ctx.modelId = agent.getModelId();
		return agent.stream(chat.messages, { provider: 'mattermost', timezone: ctx.timezone });
	}

	private async _readStreamAndUpdateMessage(
		stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
		ctx: ConversationContext,
		projectId: string,
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
				await this._handleChartPart(part, state, ctx, projectId);
			}
			lastMessage = uiMessage;
		}

		await this._sendFinalText(ctx);
		return { ...state, lastMessage };
	}

	private async _safeEdit(message: SentMessage, content: string | CardElement): Promise<void> {
		try {
			await message.edit(content);
		} catch (error) {
			if (error instanceof Error && error.message.includes('message is not modified')) {
				console.warn('Mattermost edit skipped (content identical)');
			} else {
				throw error;
			}
		}
	}

	private async _renderCurrentText(ctx: ConversationContext): Promise<string> {
		const texts: string[] = [];
		for (const child of ctx.blocks) {
			if (child && typeof child === 'object' && 'content' in child && typeof child.content === 'string') {
				texts.push(child.content);
			}
		}
		return texts.join('\n\n');
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
			await this._safeEdit(ctx.convMessage, await this._renderCurrentText(ctx));
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
		projectId: string,
	): Promise<void> {
		if (part.state !== 'output-available' || state.renderedChartIds.has(part.toolCallId)) {
			return;
		}
		const sqlOutput = state.sqlOutputs.get(part.input.query_id);
		if (!sqlOutput) {
			return;
		}
		try {
			const displaySettings = await projectQueries.getDisplaySettings(projectId);
			const png = generateChartImage({
				config: part.input,
				data: sqlOutput.rows,
				dateFormat: displaySettings.dateFormat,
			});
			state.renderedChartIds.add(part.toolCallId);
			ctx.textBlockIndex = -1;

			await ctx.thread.post({
				markdown: '',
				files: [{ data: png, filename: 'chart.png' }],
			});

			if (ctx.convMessage) {
				await this._safeEdit(ctx.convMessage, await this._renderCurrentText(ctx));
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
				await this._safeEdit(ctx.convMessage, await this._renderCurrentText(ctx));
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
			await this._safeEdit(ctx.convMessage, await this._renderCurrentText(ctx));
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
		const chat = await chatQueries.getChatByMattermostThread(threadId);
		if (!chat) {
			return null;
		}
		return chatQueries.getLastAssistantMessageId(chat.id);
	}
}

export const mattermostService = new MatterMostService();
